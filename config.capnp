using Workerd = import "/workerd/workerd.capnp";

const config :Workerd.Config = (
  services = [
    (name = "main", worker = .worker),
  ],
  sockets = [
    (service = "main", name = "http", address = "*:8080", http = ()),
  ],
);

const worker :Workerd.Worker = (
  modules = [
    (name = "worker", esModule = embed "dist/index.js"),
  ],
  # Match the compatibility_date in wrangler.test.jsonc
  compatibilityDate = "2026-08-22",
  # Enable Node.js compatibility to match wrangler.test.jsonc
  compatibilityFlags = ["nodejs_compat"],
);
