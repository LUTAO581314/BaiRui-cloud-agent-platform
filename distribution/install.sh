#!/usr/bin/env bash
set -Eeuo pipefail

readonly REPOSITORY="LUTAO581314/BaiRui-cloud-agent-platform"
readonly INSTALLER_VERSION="0.1.0-rc.8"

RELEASE_VERSION="$INSTALLER_VERSION"
DOMAIN=""
ADMIN_EMAIL=""
INSTALL_DIR="${BAIRUI_INSTALL_DIR:-/opt/bairui-agent}"
CONFIG_DIR="${BAIRUI_CONFIG_DIR:-/etc/bairui-agent}"
DATA_ROOT="${BAIRUI_DATA_ROOT:-/var/lib/bairui}"
BUNDLE_DIR="${BAIRUI_BUNDLE_DIR:-}"
VERIFY_ONLY=0
DEPLOYMENT_STARTED=0
ROLLBACK_DIR=""
DEPLOYMENT_MODE="direct"
EXTERNAL_PROXY_BIND=""
EXTERNAL_PROXY_REQUESTED=0

log() { printf '[bairui-agent] %s\n' "$*"; }
fail() { printf '[bairui-agent] ERROR: %s\n' "$*" >&2; return 1; }
require_command() { command -v "$1" >/dev/null 2>&1 || fail "$1 is required"; }

validate_external_proxy_bind() {
  local bind="$1" port second third fourth octet
  if [[ "$bind" =~ ^\[::1\]:([0-9]+)$ ]]; then
    port="${BASH_REMATCH[1]}"
  elif [[ "$bind" =~ ^127\.([0-9]{1,3})\.([0-9]{1,3})\.([0-9]{1,3}):([0-9]+)$ ]]; then
    second="${BASH_REMATCH[1]}"
    third="${BASH_REMATCH[2]}"
    fourth="${BASH_REMATCH[3]}"
    port="${BASH_REMATCH[4]}"
    for octet in "$second" "$third" "$fourth"; do
      if [[ ! "$octet" =~ ^(0|[1-9][0-9]{0,2})$ ]] || ((10#$octet > 255)); then
        fail "--external-proxy-bind contains an invalid IPv4 loopback address"
        return 1
      fi
    done
  else
    fail "--external-proxy-bind must use an IPv4 loopback address in 127.0.0.0/8 or [::1]"
    return 1
  fi
  if [[ ! "$port" =~ ^[1-9][0-9]{3,4}$ ]] || ((10#$port < 1024 || 10#$port > 65535)); then
    fail "--external-proxy-bind port must be between 1024 and 65535"
    return 1
  fi
}

usage() {
  cat <<'EOF'
Usage: install.sh --domain <hostname> [options]

Options:
  --version <version>       Exact BaiRui version, without or with leading v
  --domain <hostname>       Public HTTPS hostname
  --admin-email <email>     Bootstrap administrator email
  --install-dir <path>      Release files, default /opt/bairui-agent
  --config-dir <path>       Protected configuration, default /etc/bairui-agent
  --data-root <path>        Agent and backup data, default /var/lib/bairui
  --bundle-dir <path>       Use an already extracted release bundle
  --external-proxy-bind <loopback:port>
                            Bind Caddy behind an existing proxy, for example
                            127.0.0.1:18080 or [::1]:18080
  --verify-only             Verify bundle and Compose without installing
  --help                    Show this help
EOF
}

while (($#)); do
  case "$1" in
    --version) RELEASE_VERSION="${2:?missing version}"; shift 2 ;;
    --domain) DOMAIN="${2:?missing domain}"; shift 2 ;;
    --admin-email) ADMIN_EMAIL="${2:?missing admin email}"; shift 2 ;;
    --install-dir) INSTALL_DIR="${2:?missing install directory}"; shift 2 ;;
    --config-dir) CONFIG_DIR="${2:?missing config directory}"; shift 2 ;;
    --data-root) DATA_ROOT="${2:?missing data root}"; shift 2 ;;
    --bundle-dir) BUNDLE_DIR="${2:?missing bundle directory}"; shift 2 ;;
    --external-proxy-bind) EXTERNAL_PROXY_BIND="${2:?missing external proxy bind}"; EXTERNAL_PROXY_REQUESTED=1; shift 2 ;;
    --verify-only) VERIFY_ONLY=1; shift ;;
    --help|-h) usage; exit 0 ;;
    *) fail "unknown argument: $1" ;;
  esac
done

RELEASE_VERSION="${RELEASE_VERSION#v}"
[[ "$RELEASE_VERSION" =~ ^[0-9]+\.[0-9]+\.[0-9]+(-[0-9A-Za-z.-]+)?$ ]] || fail "invalid version"
[[ "$INSTALLER_VERSION" == "$RELEASE_VERSION" ]] || fail "installer version $INSTALLER_VERSION cannot install $RELEASE_VERSION"
if ((EXTERNAL_PROXY_REQUESTED == 1)); then
  validate_external_proxy_bind "$EXTERNAL_PROXY_BIND"
  DEPLOYMENT_MODE="external-proxy"
fi

TEMP_DIR="$(mktemp -d)"
cleanup() { rm -rf "$TEMP_DIR"; }
trap cleanup EXIT

download_bundle() {
  if [[ -n "$BUNDLE_DIR" ]]; then
    BUNDLE_DIR="$(cd "$BUNDLE_DIR" && pwd)"
    return
  fi
  require_command curl || return 1
  require_command sha256sum || return 1
  local base="https://github.com/${REPOSITORY}/releases/download/v${RELEASE_VERSION}"
  curl --fail --silent --show-error --location "$base/bairui-agent.tar.gz" -o "$TEMP_DIR/bairui-agent.tar.gz"
  curl --fail --silent --show-error --location "$base/SHA256SUMS" -o "$TEMP_DIR/SHA256SUMS"
  (cd "$TEMP_DIR" && grep '  bairui-agent.tar.gz$' SHA256SUMS | sha256sum --check --strict -)
  mkdir -p "$TEMP_DIR/bundle"
  tar -xzf "$TEMP_DIR/bairui-agent.tar.gz" -C "$TEMP_DIR/bundle"
  BUNDLE_DIR="$TEMP_DIR/bundle"
}

verify_bundle() {
  require_command jq || return 1
  for file in release-manifest.json compose.yaml compose.external-proxy.yaml Caddyfile; do
    if [[ ! -f "$BUNDLE_DIR/$file" ]]; then
      fail "bundle is missing $file"
      return 1
    fi
  done
  jq -e --arg version "$RELEASE_VERSION" '
    .schemaVersion == "1.0" and
    .product == "bairui-agent" and
    .version == $version and
    .database.engine == "postgresql" and
    ([.images.platform,.images.runtime,.images.hermes,.images.postgres,.images.caddy] |
      all(test("@sha256:[a-f0-9]{64}$")))
  ' "$BUNDLE_DIR/release-manifest.json" >/dev/null || { fail "release manifest validation failed"; return 1; }
  if command -v docker >/dev/null 2>&1 && docker compose version >/dev/null 2>&1; then
    local fixture="$TEMP_DIR/verify.env"
    cat > "$fixture" <<EOF
BAIRUI_POSTGRES_IMAGE=$(jq -r .images.postgres "$BUNDLE_DIR/release-manifest.json")
BAIRUI_PLATFORM_IMAGE=$(jq -r .images.platform "$BUNDLE_DIR/release-manifest.json")
BAIRUI_RUNTIME_IMAGE=$(jq -r .images.runtime "$BUNDLE_DIR/release-manifest.json")
BAIRUI_HERMES_IMAGE=$(jq -r .images.hermes "$BUNDLE_DIR/release-manifest.json")
BAIRUI_CADDY_IMAGE=$(jq -r .images.caddy "$BUNDLE_DIR/release-manifest.json")
POSTGRES_PASSWORD=verify-only-password
BAIRUI_PLATFORM_ORIGIN=https://verify.example.test
BAIRUI_SITE_ADDRESS=verify.example.test
BAIRUI_DEPLOYMENT_MODE=direct
BAIRUI_EXTERNAL_PROXY_BIND=127.0.0.1:18080
BAIRUI_SESSION_SECRET=verify-session-secret-at-least-32-characters
BAIRUI_BOOTSTRAP_ADMIN_EMAIL=admin@verify.example.test
BAIRUI_BOOTSTRAP_ADMIN_PASSWORD=verify-admin-password
BAIRUI_AGENT_INGEST_TOKEN=verify-agent-ingest-token-at-least-32-characters
BAIRUI_CHANNEL_WORKER_TOKEN=verify-channel-worker-token-at-least-32-characters
BAIRUI_RUNTIME_SHARED_SECRET=verify-runtime-secret-at-least-32-characters
BAIRUI_PROVIDER_ENCRYPTION_KEY=verify-provider-key-at-least-32-characters
BAIRUI_LICENSE_PRIVATE_KEY=verify-license-private-key
BAIRUI_SERVER_ID=verify-server
BAIRUI_SERVER_AGENT_TOKEN=verify-server-token-at-least-32-characters
BAIRUI_BACKUP_ENCRYPTION_KEY=verify-backup-key-at-least-32-characters
BAIRUI_AGENT_DATA_ROOT=$TEMP_DIR/agents
BAIRUI_BACKUP_DATA_ROOT=$TEMP_DIR/backups
EOF
    local direct_config="$TEMP_DIR/direct-compose.json" external_config="$TEMP_DIR/external-compose.json"
    docker compose --env-file "$fixture" -f "$BUNDLE_DIR/compose.yaml" config --format json > "$direct_config"
    jq -e '
      .services.caddy.environment.BAIRUI_SITE_ADDRESS == "verify.example.test" and
      (.services.caddy.ports | length == 3) and
      ([.services.caddy.ports[] | select(.target == 80 and (.published | tostring) == "80" and .protocol == "tcp")] | length == 1) and
      ([.services.caddy.ports[] | select(.target == 443 and (.published | tostring) == "443" and .protocol == "tcp")] | length == 1) and
      ([.services.caddy.ports[] | select(.target == 443 and (.published | tostring) == "443" and .protocol == "udp")] | length == 1)
    ' "$direct_config" >/dev/null || { fail "direct TLS Compose validation failed"; return 1; }
    docker compose --env-file "$fixture" -f "$BUNDLE_DIR/compose.yaml" -f "$BUNDLE_DIR/compose.external-proxy.yaml" config --format json > "$external_config"
    jq -e '
      .services.caddy.environment.BAIRUI_SITE_ADDRESS == ":8080" and
      (.services.caddy.ports | length == 1) and
      (.services.caddy.ports[0].host_ip == "127.0.0.1") and
      (.services.caddy.ports[0].target == 8080) and
      ((.services.caddy.ports[0].published | tostring) == "18080") and
      .services.caddy.ports[0].protocol == "tcp"
    ' "$external_config" >/dev/null || { fail "external proxy Compose validation failed"; return 1; }
  fi
  log "release bundle v$RELEASE_VERSION verified"
}

install_host_dependencies() {
  require_command apt-get || return 1
  export DEBIAN_FRONTEND=noninteractive
  apt-get update
  apt-get install -y ca-certificates curl jq openssl tar gnupg
  if command -v docker >/dev/null 2>&1 && docker compose version >/dev/null 2>&1; then return; fi
  # shellcheck disable=SC1091
  . /etc/os-release
  if [[ "$ID" != "ubuntu" && "$ID" != "debian" ]]; then
    fail "automatic Docker installation supports Ubuntu and Debian"
    return 1
  fi
  install -d -m 0755 /etc/apt/keyrings
  curl -fsSL "https://download.docker.com/linux/$ID/gpg" | gpg --dearmor --yes -o /etc/apt/keyrings/docker.gpg
  chmod a+r /etc/apt/keyrings/docker.gpg
  local architecture codename
  architecture="$(dpkg --print-architecture)"
  codename="${VERSION_CODENAME:?missing OS codename}"
  printf 'deb [arch=%s signed-by=/etc/apt/keyrings/docker.gpg] https://download.docker.com/linux/%s %s stable\n' "$architecture" "$ID" "$codename" > /etc/apt/sources.list.d/docker.list
  apt-get update
  apt-get install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
  systemctl enable --now docker
}

random_hex() { openssl rand -hex "${1:-32}"; }

set_env_value() {
  local file="$1" key="$2" value="$3" temporary
  if [[ "$value" == *$'\n'* || "$value" == *$'\r'* ]]; then
    fail "$key contains a newline"
    return 1
  fi
  temporary="$(mktemp "${file}.XXXXXX")"
  awk -v key="$key" -v value="$value" 'BEGIN{found=0} index($0,key "=")==1 {print key "=" value; found=1; next} {print} END{if(!found) print key "=" value}' "$file" > "$temporary"
  chmod 0600 "$temporary"
  mv "$temporary" "$file"
}

read_env_value() {
  local file="$1" key="$2"
  awk -v key="$key" 'index($0,key "=")==1 {print substr($0,length(key)+2); exit}' "$file"
}

resolve_deployment_mode() {
  local saved_mode saved_bind
  if ((EXTERNAL_PROXY_REQUESTED == 1)) || [[ ! -f "$CONFIG_DIR/bairui.env" ]]; then return; fi
  saved_mode="$(read_env_value "$CONFIG_DIR/bairui.env" BAIRUI_DEPLOYMENT_MODE)"
  case "$saved_mode" in
    ""|direct)
      DEPLOYMENT_MODE="direct"
      EXTERNAL_PROXY_BIND=""
      ;;
    external-proxy)
      saved_bind="$(read_env_value "$CONFIG_DIR/bairui.env" BAIRUI_EXTERNAL_PROXY_BIND)"
      validate_external_proxy_bind "$saved_bind" || return 1
      DEPLOYMENT_MODE="external-proxy"
      EXTERNAL_PROXY_BIND="$saved_bind"
      ;;
    *) fail "stored BAIRUI_DEPLOYMENT_MODE is invalid: $saved_mode"; return 1 ;;
  esac
}

write_initial_environment() {
  local manifest="$INSTALL_DIR/release-manifest.json"
  local license_key
  license_key="$(openssl genpkey -algorithm ED25519 2>/dev/null | awk '{printf "%s\\n",$0}')"
  BAIRUI_BOOTSTRAP_ADMIN_PASSWORD="${BAIRUI_BOOTSTRAP_ADMIN_PASSWORD:-$(random_hex 18)}"
  ADMIN_EMAIL="${ADMIN_EMAIL:-admin@$DOMAIN}"
  cat > "$CONFIG_DIR/bairui.env" <<EOF
BAIRUI_RELEASE_VERSION=$RELEASE_VERSION
BAIRUI_POSTGRES_IMAGE=$(jq -r .images.postgres "$manifest")
BAIRUI_PLATFORM_IMAGE=$(jq -r .images.platform "$manifest")
BAIRUI_RUNTIME_IMAGE=$(jq -r .images.runtime "$manifest")
BAIRUI_HERMES_IMAGE=$(jq -r .images.hermes "$manifest")
BAIRUI_CADDY_IMAGE=$(jq -r .images.caddy "$manifest")
POSTGRES_PASSWORD=$(random_hex 24)
BAIRUI_PLATFORM_ORIGIN=https://$DOMAIN
BAIRUI_SITE_ADDRESS=$DOMAIN
BAIRUI_DEPLOYMENT_MODE=$DEPLOYMENT_MODE
BAIRUI_EXTERNAL_PROXY_BIND=$EXTERNAL_PROXY_BIND
BAIRUI_SESSION_SECRET=$(random_hex 32)
BAIRUI_BOOTSTRAP_ADMIN_EMAIL=$ADMIN_EMAIL
BAIRUI_BOOTSTRAP_ADMIN_PASSWORD=$BAIRUI_BOOTSTRAP_ADMIN_PASSWORD
BAIRUI_AGENT_INGEST_TOKEN=$(random_hex 32)
BAIRUI_CHANNEL_WORKER_ID=channel-worker-primary
BAIRUI_CHANNEL_WORKER_TOKEN=$(random_hex 32)
BAIRUI_RUNTIME_SHARED_SECRET=$(random_hex 32)
BAIRUI_PROVIDER_ENCRYPTION_KEY=$(random_hex 32)
BAIRUI_LICENSE_PRIVATE_KEY='$license_key'
BAIRUI_ALLOW_REGISTRATION=0
BAIRUI_SERVER_ID=pending-registration
BAIRUI_SERVER_AGENT_TOKEN=$(random_hex 32)
BAIRUI_BACKUP_ENCRYPTION_KEY=$(random_hex 32)
BAIRUI_AGENT_DATA_ROOT=$DATA_ROOT/agents
BAIRUI_BACKUP_DATA_ROOT=$DATA_ROOT/backups
BAIRUI_RUNTIME_PORT_START=19000
BAIRUI_RUNTIME_PORT_END=19999
EOF
  chmod 0600 "$CONFIG_DIR/bairui.env"
  cat > "$CONFIG_DIR/initial-admin.txt" <<EOF
URL=https://$DOMAIN
EMAIL=$ADMIN_EMAIL
PASSWORD=$BAIRUI_BOOTSTRAP_ADMIN_PASSWORD
EOF
  chmod 0600 "$CONFIG_DIR/initial-admin.txt"
}

refresh_release_environment() {
  local env_file="$CONFIG_DIR/bairui.env" manifest="$INSTALL_DIR/release-manifest.json"
  set_env_value "$env_file" BAIRUI_RELEASE_VERSION "$RELEASE_VERSION" || return 1
  for entry in POSTGRES:postgres PLATFORM:platform RUNTIME:runtime HERMES:hermes CADDY:caddy; do
    local env_name="BAIRUI_${entry%%:*}_IMAGE" manifest_name="${entry##*:}"
    set_env_value "$env_file" "$env_name" "$(jq -r ".images.$manifest_name" "$manifest")" || return 1
  done
  set_env_value "$env_file" BAIRUI_DEPLOYMENT_MODE "$DEPLOYMENT_MODE" || return 1
  set_env_value "$env_file" BAIRUI_EXTERNAL_PROXY_BIND "$EXTERNAL_PROXY_BIND" || return 1
}

compose() {
  local mode bind
  local compose_args=(--env-file "$CONFIG_DIR/bairui.env" -f "$INSTALL_DIR/compose.yaml")
  mode="$(read_env_value "$CONFIG_DIR/bairui.env" BAIRUI_DEPLOYMENT_MODE)"
  mode="${mode:-direct}"
  case "$mode" in
    direct) ;;
    external-proxy)
      bind="$(read_env_value "$CONFIG_DIR/bairui.env" BAIRUI_EXTERNAL_PROXY_BIND)"
      validate_external_proxy_bind "$bind" || return 1
      if [[ ! -f "$INSTALL_DIR/compose.external-proxy.yaml" ]]; then
        fail "external proxy Compose override is missing"
        return 1
      fi
      compose_args+=(-f "$INSTALL_DIR/compose.external-proxy.yaml")
      ;;
    *) fail "stored BAIRUI_DEPLOYMENT_MODE is invalid: $mode"; return 1 ;;
  esac
  docker compose "${compose_args[@]}" "$@"
}

rollback_on_error() {
  local status=$?
  trap - ERR
  if ((status != 0 && DEPLOYMENT_STARTED == 1)) && [[ -n "$ROLLBACK_DIR" && -d "$ROLLBACK_DIR" ]]; then
    log "health gate failed; restoring previous release"
    cp "$ROLLBACK_DIR/compose.yaml" "$INSTALL_DIR/compose.yaml"
    cp "$ROLLBACK_DIR/Caddyfile" "$INSTALL_DIR/Caddyfile"
    cp "$ROLLBACK_DIR/release-manifest.json" "$INSTALL_DIR/release-manifest.json"
    if [[ -f "$ROLLBACK_DIR/compose.external-proxy.yaml" ]]; then
      cp "$ROLLBACK_DIR/compose.external-proxy.yaml" "$INSTALL_DIR/compose.external-proxy.yaml"
    else
      rm -f "$INSTALL_DIR/compose.external-proxy.yaml"
    fi
    cp "$ROLLBACK_DIR/bairui.env" "$CONFIG_DIR/bairui.env"
    compose up -d --no-deps --force-recreate platform || true
    compose up -d --no-deps --force-recreate channel-worker caddy || true
    compose --profile node up -d --no-deps --force-recreate server-agent || true
  fi
  exit "$status"
}

wait_for_platform() {
  local url="https://$DOMAIN/ready"
  for _ in $(seq 1 90); do
    if curl --fail --silent --show-error "$url" | jq -e '.ready == true and .backend == "postgresql"' >/dev/null 2>&1; then return; fi
    sleep 2
  done
  fail "Platform readiness did not pass at $url"
}

assert_container_image() {
  local service="$1" expected="$2" container_id actual
  container_id="$(compose ps -q "$service")"
  if [[ -z "$container_id" ]]; then
    fail "$service container is missing"
    return 1
  fi
  actual="$(docker inspect --format '{{.Config.Image}}' "$container_id")"
  if [[ "$actual" != "$expected" ]]; then
    fail "$service is not running the release manifest image"
    return 1
  fi
}

verify_running_images() {
  # shellcheck disable=SC1090,SC1091
  source "$CONFIG_DIR/bairui.env"
  assert_container_image postgres "$BAIRUI_POSTGRES_IMAGE" || return 1
  assert_container_image platform "$BAIRUI_PLATFORM_IMAGE" || return 1
  assert_container_image channel-worker "$BAIRUI_PLATFORM_IMAGE" || return 1
  assert_container_image caddy "$BAIRUI_CADDY_IMAGE" || return 1
  assert_container_image server-agent "$BAIRUI_PLATFORM_IMAGE" || return 1
}

register_server_agent() {
  # shellcheck disable=SC1090,SC1091
  source "$CONFIG_DIR/bairui.env"
  if [[ "$BAIRUI_SERVER_ID" != "pending-registration" ]]; then return; fi
  local cookie="$TEMP_DIR/session.cookie" login="$TEMP_DIR/login.json" request="$TEMP_DIR/server.json" response="$TEMP_DIR/server-response.json"
  jq -n --arg email "$BAIRUI_BOOTSTRAP_ADMIN_EMAIL" --arg password "$BAIRUI_BOOTSTRAP_ADMIN_PASSWORD" '{email:$email,password:$password}' > "$login"
  curl --fail --silent --show-error --cookie-jar "$cookie" -H 'content-type: application/json' --data-binary "@$login" "$BAIRUI_PLATFORM_ORIGIN/api/auth/login" >/dev/null
  jq -n --arg organizationId org_bairui --arg name "$(hostname -s)" '{organizationId:$organizationId,name:$name}' > "$request"
  curl --fail --silent --show-error --cookie "$cookie" -H 'content-type: application/json' --data-binary "@$request" "$BAIRUI_PLATFORM_ORIGIN/api/admin/servers" > "$response"
  local server_id server_token
  server_id="$(jq -er .server.id "$response")"
  server_token="$(jq -er .credential.token "$response")"
  if [[ ! "$server_id" =~ ^[A-Za-z0-9._:-]+$ || ${#server_token} -lt 32 ]]; then
    fail "Platform returned an invalid Server Agent credential"
    return 1
  fi
  set_env_value "$CONFIG_DIR/bairui.env" BAIRUI_SERVER_ID "$server_id" || return 1
  set_env_value "$CONFIG_DIR/bairui.env" BAIRUI_SERVER_AGENT_TOKEN "$server_token" || return 1
}

download_bundle
verify_bundle
if ((VERIFY_ONLY == 1)); then exit 0; fi
[[ $EUID -eq 0 ]] || fail "installation must run as root"
[[ "$(uname -m)" == "x86_64" ]] || fail "this release supports amd64 only"
[[ "$DOMAIN" =~ ^[A-Za-z0-9]([A-Za-z0-9.-]*[A-Za-z0-9])?$ ]] || fail "--domain must be a DNS hostname"
if [[ -n "$ADMIN_EMAIL" ]]; then [[ "$ADMIN_EMAIL" =~ ^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+$ ]] || fail "invalid administrator email"; fi
resolve_deployment_mode

install_host_dependencies
docker_major="$(docker version --format '{{.Server.Version}}' | cut -d. -f1)"
((docker_major >= 27)) || fail "Docker 27 or newer is required"

install -d -m 0755 "$INSTALL_DIR" "$INSTALL_DIR/releases"
install -d -m 0700 "$CONFIG_DIR" "$DATA_ROOT/agents" "$DATA_ROOT/backups"
if [[ -f "$INSTALL_DIR/release-manifest.json" && -f "$CONFIG_DIR/bairui.env" ]]; then
  old_version="$(jq -r .version "$INSTALL_DIR/release-manifest.json")"
  ROLLBACK_DIR="$INSTALL_DIR/releases/$old_version"
  install -d -m 0700 "$ROLLBACK_DIR"
  cp "$INSTALL_DIR/compose.yaml" "$INSTALL_DIR/Caddyfile" "$INSTALL_DIR/release-manifest.json" "$ROLLBACK_DIR/"
  rm -f "$ROLLBACK_DIR/compose.external-proxy.yaml"
  if [[ -f "$INSTALL_DIR/compose.external-proxy.yaml" ]]; then
    cp "$INSTALL_DIR/compose.external-proxy.yaml" "$ROLLBACK_DIR/compose.external-proxy.yaml"
  fi
  cp "$CONFIG_DIR/bairui.env" "$ROLLBACK_DIR/bairui.env"
  chmod 0600 "$ROLLBACK_DIR/bairui.env"
fi
trap rollback_on_error ERR
DEPLOYMENT_STARTED=1
install -m 0644 "$BUNDLE_DIR/compose.yaml" "$INSTALL_DIR/compose.yaml"
install -m 0644 "$BUNDLE_DIR/compose.external-proxy.yaml" "$INSTALL_DIR/compose.external-proxy.yaml"
install -m 0644 "$BUNDLE_DIR/Caddyfile" "$INSTALL_DIR/Caddyfile"
install -m 0644 "$BUNDLE_DIR/release-manifest.json" "$INSTALL_DIR/release-manifest.json"
if [[ ! -f "$CONFIG_DIR/bairui.env" ]]; then write_initial_environment; else refresh_release_environment; fi

compose pull postgres platform channel-worker caddy
docker pull "$(jq -r .images.runtime "$INSTALL_DIR/release-manifest.json")"
docker pull "$(jq -r .images.hermes "$INSTALL_DIR/release-manifest.json")"
compose up -d --wait postgres
compose up -d --no-deps --force-recreate --wait platform
compose up -d --no-deps --force-recreate --wait channel-worker caddy
wait_for_platform
register_server_agent
compose --profile node up -d --no-deps --force-recreate server-agent
sleep 3
if [[ "$(compose ps --status running --services | grep -c '^server-agent$')" != "1" ]]; then
  fail "Server Agent is not running"
fi
verify_running_images
compose exec -T platform node -e 'fetch("http://127.0.0.1:3000/ready").then(async r=>{const b=await r.json();if(!r.ok||b.ready!==true||b.backend!=="postgresql")process.exit(1)}).catch(()=>process.exit(1))'
compose exec -T channel-worker node -e 'fetch("http://127.0.0.1:8790/ready").then(async r=>{const b=await r.json();if(!r.ok||b.ready!==true)process.exit(1)}).catch(()=>process.exit(1))'
DEPLOYMENT_STARTED=0
trap - ERR
log "installed bairui-agent v$RELEASE_VERSION at https://$DOMAIN"
if [[ "$DEPLOYMENT_MODE" == "external-proxy" ]]; then log "Caddy is bound for the external proxy at $EXTERNAL_PROXY_BIND"; fi
log "initial administrator credentials: $CONFIG_DIR/initial-admin.txt"
