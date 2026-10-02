"""Compare actual OCI pushes from one Actions runner without logging credentials."""
import base64
import gzip
import hashlib
import http.client
import io
import json
import os
from pathlib import Path
import ssl
import subprocess
import tarfile
import tempfile
import time
from urllib.parse import parse_qsl, urlencode, urlsplit, urlunsplit

REPO = 'lazycampus/agent-backend'
DIRECT = 'https://ccr.ccs.tencentyun.com'
ROUTES = {'direct': DIRECT, 'edgeone': 'https://xget.lazycampus.com',
          'cloudflare': os.environ['CF_BENCHMARK_URL'].rstrip('/')}
cf_url = urlsplit(ROUTES['cloudflare'])
if (cf_url.scheme != 'https' or not (cf_url.hostname or '').endswith('.workers.dev')
        or cf_url.username or cf_url.password or cf_url.path or cf_url.query or cf_url.fragment):
    raise SystemExit('Cloudflare benchmark URL must be a workers.dev HTTPS origin')
BASIC = 'Basic ' + base64.b64encode((os.environ['TCR_USERNAME'] + ':' + os.environ['TCR_PASSWORD']).encode()).decode()
OUT = Path('tcr-benchmark-results.jsonl')
OUT.write_text('')
RUN = os.environ.get('GITHUB_RUN_ID', str(int(time.time())))


def digest(data):
    return 'sha256:' + hashlib.sha256(data).hexdigest()


def emit(row):
    line = json.dumps(row, sort_keys=True)
    with OUT.open('a') as f:
        f.write(line + '\n')
    print(line, flush=True)


class Registry:
    def __init__(self, route):
        self.route = route
        self.origin = ROUTES[route]
        self.prefix = '/v2/' if route == 'direct' else '/cr/tcr/v2/'
        self.token = None
        self.connections = {}
        self.requests = 0
        self.sent = 0

    def request(self, method, path, body=b'', headers=None, authorization=True):
        url = urlsplit(path if path.startswith('https://') else self.origin + path)
        if url.scheme != 'https' or url.netloc != urlsplit(self.origin).netloc:
            raise RuntimeError('upload continuation escaped the selected proxy')
        conn = self.connections.get(url.netloc)
        if conn is None:
            conn = http.client.HTTPSConnection(url.netloc, timeout=90, context=ssl.create_default_context())
            self.connections[url.netloc] = conn
        h = {'User-Agent': 'lazycampus-tcr-benchmark/1.0', **(headers or {})}
        if authorization and self.token:
            h['Authorization'] = 'Bearer ' + self.token
        self.requests += 1
        self.sent += len(body)
        conn.request(method, urlunsplit(('', '', url.path, url.query, '')), body=body, headers=h)
        response = conn.getresponse()
        status, result_headers, result = response.status, dict(response.getheaders()), response.read()
        result_headers = {k.lower(): v for k, v in result_headers.items()}
        if result_headers.get('connection', '').lower() == 'close':
            conn.close()
            self.connections.pop(url.netloc, None)
        return status, result_headers, result

    def auth(self):
        if self.route == 'direct':
            path = '/service/token?' + urlencode({'service': 'token-service', 'scope': f'repository:{REPO}:pull,push'})
        else:
            path = '/cr/tcr/v2/auth?' + urlencode({'service': 'Xget', 'scope': f'repository:cr/tcr/{REPO}:pull,push'})
        status, _, body = self.request('GET', path, headers={'Authorization': BASIC}, authorization=False)
        if status != 200:
            raise RuntimeError(f'token service HTTP {status}')
        data = json.loads(body)
        self.token = data.get('token') or data.get('access_token')
        if not self.token:
            raise RuntimeError('token service returned no token')

    def upload(self, data, chunk):
        path = self.prefix + REPO + '/blobs/uploads/'
        status, h, _ = self.request('POST', path)
        if status != 202 or not h.get('location'):
            raise RuntimeError(f'upload start HTTP {status}')
        location = h['location']
        for offset in range(0, len(data), chunk):
            part = data[offset:offset+chunk]
            status, h, _ = self.request('PATCH', location, part, {
                'Content-Type': 'application/octet-stream',
                'Content-Range': f'{offset}-{offset+len(part)-1}'})
            if status != 202 or not h.get('location'):
                raise RuntimeError(f'layer PATCH HTTP {status} at offset {offset}')
            location = h['location']
        parsed = urlsplit(location)
        query = parse_qsl(parsed.query, keep_blank_values=True) + [('digest', digest(data))]
        location = urlunsplit((parsed.scheme, parsed.netloc, parsed.path, urlencode(query), ''))
        status, h, _ = self.request('PUT', location)
        if status != 201 or h.get('docker-content-digest') != digest(data):
            raise RuntimeError(f'blob commit or digest validation failed (HTTP {status})')

    def close(self):
        for c in self.connections.values():
            c.close()


def image_payload(size):
    raw = io.BytesIO()
    with tarfile.open(fileobj=raw, mode='w') as tar:
        content = os.urandom(size)
        item = tarfile.TarInfo('benchmark-payload.bin')
        item.size, item.mtime = len(content), 0
        tar.addfile(item, io.BytesIO(content))
    tarbytes = raw.getvalue()
    layer = gzip.compress(tarbytes, compresslevel=1, mtime=0)
    config = json.dumps({'architecture': 'amd64', 'os': 'linux', 'config': {},
                         'rootfs': {'type': 'layers', 'diff_ids': [digest(tarbytes)]}}).encode()
    manifest = json.dumps({'schemaVersion': 2, 'mediaType': 'application/vnd.oci.image.manifest.v1+json',
                          'config': {'mediaType': 'application/vnd.oci.image.config.v1+json', 'digest': digest(config), 'size': len(config)},
                          'layers': [{'mediaType': 'application/vnd.oci.image.layer.v1.tar+gzip', 'digest': digest(layer), 'size': len(layer)}]}).encode()
    return layer, config, manifest


def push(route, attempt, mode, payload):
    layer, config, manifest = payload
    client = Registry(route)
    row = {'kind': 'oci_push', 'route': route, 'attempt': attempt, 'mode': mode,
           'layer_bytes': len(layer), 'layer_digest': digest(layer), 'retries': 0,
           'runner_os': os.environ.get('RUNNER_OS'), 'success': False}
    start = time.monotonic()
    tag = f'xget-benchmark-{RUN}-{mode}-{attempt}-{route}'
    try:
        client.auth()
        row['auth_s'] = round(time.monotonic()-start, 4)
        upload_start = time.monotonic()
        chunk = 512*1024 if mode == 'chunked' else len(layer)
        client.upload(layer, chunk)
        client.upload(config, chunk)
        status, h, _ = client.request('PUT', client.prefix + REPO + '/manifests/' + tag, manifest,
                                     {'Content-Type': 'application/vnd.oci.image.manifest.v1+json'})
        if status != 201 or h.get('docker-content-digest') != digest(manifest):
            raise RuntimeError(f'image manifest commit failed (HTTP {status})')
        row['push_s'] = round(time.monotonic()-upload_start, 4)
        row['total_push_s'] = round(time.monotonic()-start, 4)
        row['mib_s'] = round(len(layer)/(1024*1024)/row['push_s'], 4)
        # Verify against TCR directly so a proxy cannot produce a false success.
        verifier = Registry('direct')
        try:
            verifier.auth()
            status, h, body = verifier.request('GET', '/v2/'+REPO+'/manifests/'+tag,
                                              headers={'Accept': 'application/vnd.oci.image.manifest.v1+json'})
            if status != 200 or digest(body) != digest(manifest):
                raise RuntimeError(f'direct TCR manifest verification failed (HTTP {status})')
            status, h, _ = verifier.request('HEAD', '/v2/'+REPO+'/blobs/'+digest(layer))
            if status != 200 or h.get('docker-content-digest') != digest(layer):
                raise RuntimeError(f'direct TCR blob verification failed (HTTP {status})')
            row['success'] = True
            row['verified_at_tcr'] = True
        finally:
            verifier.close()
    except Exception as error:
        # Never print exception messages containing URLs, query state, or credentials.
        row['error_type'] = type(error).__name__
        row['error'] = str(error) if isinstance(error, RuntimeError) else 'transport or response parsing failed'
        row['elapsed_s'] = round(time.monotonic()-start, 4)
    finally:
        row['http_requests'], row['sent_bytes'] = client.requests, client.sent
        client.close()
    emit(row)


def native(route, attempt, size):
    # Fresh equal-size incompressible layers avoid Docker's "Layer already exists"
    # optimization hiding upload failures on the route tested second.
    with tempfile.TemporaryDirectory(prefix='tcr-native-') as d:
        Path(d, 'payload.bin').write_bytes(os.urandom(size))
        Path(d, 'Dockerfile').write_text('FROM scratch\nCOPY payload.bin /payload.bin\n')
        tag = f'xget-benchmark-{RUN}-native-{attempt}-{route}'
        host = urlsplit(ROUTES[route]).netloc
        name = host + '/' + ('' if route == 'direct' else 'cr/tcr/') + REPO + ':' + tag
        subprocess.run(['docker', 'build', '--quiet', '-t', name, d], check=True, capture_output=True, timeout=60)
        row = dict(kind='docker_push', route=route, attempt=attempt, payload_bytes=size,
                   success=False, retries='Docker internal retries; no outer retries')
        start = time.monotonic()
        try:
            result = subprocess.run(['timeout', '--kill-after=5', '180', 'docker', 'push', name],
                                    capture_output=True, text=True, timeout=190)
            row['exit'] = result.returncode
            row['success'] = result.returncode == 0
            # Extract only known status/error classifications, never arbitrary logs.
            log = result.stdout + result.stderr
            row['error_class'] = ('request_body_too_large' if ('413' in log or 'too large' in log.lower())
                                  else 'timeout' if result.returncode == 124
                                  else 'registry_or_transport_error' if result.returncode else '')
        except subprocess.TimeoutExpired:
            row.update(exit=124, error_class='timeout')
        finally:
            row['push_s'] = round(time.monotonic()-start, 4)
            subprocess.run(['docker', 'image', 'rm', name], capture_output=True, timeout=15)
        emit(row)


for mode in ('chunked', 'single'):
    for attempt in range(1, 4):
        payload = image_payload(8*1024*1024)
        routes = list(ROUTES)
        shift = (attempt-1) % 3
        for route in routes[shift:] + routes[:shift]:
            push(route, attempt, mode, payload)

for route in ROUTES:
    origin_host = urlsplit(ROUTES[route]).netloc
    try:
        login = subprocess.run(['docker', 'login', origin_host, '--username', os.environ['TCR_USERNAME'], '--password-stdin'],
                               input=os.environ['TCR_PASSWORD'], capture_output=True, text=True, timeout=60)
    except subprocess.TimeoutExpired:
        emit(dict(kind='docker_login', route=route, success=False, exit=124))
        continue
    emit(dict(kind='docker_login', route=route, success=login.returncode == 0, exit=login.returncode))
    if login.returncode == 0:
        for attempt in range(1, 4):
            native(route, attempt, 8*1024*1024)
