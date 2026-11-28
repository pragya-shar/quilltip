#!/usr/bin/env bash
# Reproducible build of the Quilltip v2 contracts.
#
# Specification: docs/architecture/v2/08-testing-and-deployment.md, section 8.2.
#
# - Builds one committed tree (`git archive`), never the working copy.
# - Runs in a container pinned by digest, for linux/amd64 on every host.
# - Uses the Stellar CLI 30.0.1 release binary, checked against its SHA-256.
# - Passes --meta source_repo and --meta commit_sha.
# - Writes <out>/SHA256SUMS and <out>/sizes.tsv and fails when a Wasm exceeds
#   the size gate.
#
# Usage: scripts/contracts/build-reproducible.sh [--commit <rev>] [--out <dir>]
#          [--package <crate>] [--features <list>]
#
# --package and --features are for test builds (for example the Core
# upgrade-test Wasm). Never deploy a Wasm built with test features.
#
# The script makes no network call to Stellar and needs no keys.
set -euo pipefail

# rust:1.94.1-slim-trixie (multi-arch index). Rust matches contracts/rust-toolchain.toml.
readonly BUILD_IMAGE="docker.io/library/rust@sha256:cf09adf8c3ebaba10779e5c23ff7fe4df4cccdab8a91f199b0c142c53fef3e1a"
readonly PLATFORM="linux/amd64"
readonly STELLAR_CLI_VERSION="30.0.1"
readonly STELLAR_CLI_ASSET="stellar-cli-${STELLAR_CLI_VERSION}-x86_64-unknown-linux-gnu.tar.gz"
readonly STELLAR_CLI_SHA256="48c70074020e09af0a3ebbd2bf62d53c9aec47935e49a112d3cd90fb4e37658f"
readonly STELLAR_CLI_URL="https://github.com/stellar/stellar-cli/releases/download/v${STELLAR_CLI_VERSION}/${STELLAR_CLI_ASSET}"
readonly SOURCE_REPO="github:pragya-shar/QuillTip"
readonly MAX_WASM_BYTES=120000

commit="HEAD"
out_dir=""
package=""
features=""
while [ "$#" -gt 0 ]; do
  case "$1" in
    --commit) commit="$2"; shift 2 ;;
    --out) out_dir="$2"; shift 2 ;;
    --package) package="$2"; shift 2 ;;
    --features) features="$2"; shift 2 ;;
    -h | --help) sed -n '2,20p' "$0"; exit 0 ;;
    *) echo "Unknown argument: $1" >&2; exit 2 ;;
  esac
done

repo_root="$(git rev-parse --show-toplevel)"
commit_sha="$(git -C "$repo_root" rev-parse --verify "${commit}^{commit}")"
out_dir="${out_dir:-$repo_root/contracts/target/reproducible/$commit_sha}"

sha256_of() {
  if command -v sha256sum >/dev/null 2>&1; then
    sha256sum "$1" | cut -d' ' -f1
  else
    shasum -a 256 "$1" | cut -d' ' -f1
  fi
}

work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT
mkdir -p "$work/src" "$work/cli" "$work/out"

echo "Commit:  $commit_sha"
echo "Image:   $BUILD_IMAGE ($PLATFORM)"
echo "CLI:     stellar $STELLAR_CLI_VERSION"

git -C "$repo_root" archive "$commit_sha" contracts | tar -x -C "$work/src"

curl --fail --silent --show-error --location --proto '=https' --tlsv1.2 \
  --output "$work/cli/$STELLAR_CLI_ASSET" "$STELLAR_CLI_URL"
actual_cli_sha="$(sha256_of "$work/cli/$STELLAR_CLI_ASSET")"
if [ "$actual_cli_sha" != "$STELLAR_CLI_SHA256" ]; then
  echo "Stellar CLI checksum mismatch: $actual_cli_sha" >&2
  exit 1
fi
tar -xzf "$work/cli/$STELLAR_CLI_ASSET" -C "$work/cli" stellar

docker run --rm --platform "$PLATFORM" \
  --env HOST_UID="$(id -u)" \
  --env HOST_GID="$(id -g)" \
  --env COMMIT_SHA="$commit_sha" \
  --env BUILD_PACKAGE="$package" \
  --env BUILD_FEATURES="$features" \
  --env SOURCE_REPO="$SOURCE_REPO" \
  --volume "$work/src:/build" \
  --volume "$work/cli/stellar:/usr/local/bin/stellar:ro" \
  --volume "$work/out:/out" \
  --workdir /build/contracts \
  "$BUILD_IMAGE" \
  bash -euo pipefail -c '
    # The Linux CLI binary links libdbus (hardware-wallet support). It does not
    # take part in compiling or optimizing the Wasm.
    apt-get update -qq >/dev/null
    apt-get install -y -qq --no-install-recommends libdbus-1-3 >/dev/null
    rustc --version
    stellar --version | head -n 1
    extra=()
    if [ -n "${BUILD_PACKAGE}" ]; then extra+=(--package "${BUILD_PACKAGE}"); fi
    if [ -n "${BUILD_FEATURES}" ]; then extra+=(--features "${BUILD_FEATURES}"); fi
    stellar contract build --locked --optimize --out-dir /out \
      --meta "source_repo=${SOURCE_REPO}" \
      --meta "commit_sha=${COMMIT_SHA}" \
      "${extra[@]}"
    chown -R "${HOST_UID}:${HOST_GID}" /out /build
  '

mkdir -p "$out_dir"
: >"$out_dir/SHA256SUMS"
printf 'wasm\tbytes\tsha256\n' >"$out_dir/sizes.tsv"
oversize=0
for wasm in "$work"/out/*.wasm; do
  name="$(basename "$wasm")"
  bytes="$(wc -c <"$wasm" | tr -d ' ')"
  hash="$(sha256_of "$wasm")"
  cp "$wasm" "$out_dir/$name"
  printf '%s  %s\n' "$hash" "$name" >>"$out_dir/SHA256SUMS"
  printf '%s\t%s\t%s\n' "$name" "$bytes" "$hash" >>"$out_dir/sizes.tsv"
  if [ "$bytes" -gt "$MAX_WASM_BYTES" ]; then
    echo "Size gate: $name is $bytes bytes (limit $MAX_WASM_BYTES)" >&2
    oversize=1
  fi
done

echo
column -t -s $'\t' "$out_dir/sizes.tsv" 2>/dev/null || cat "$out_dir/sizes.tsv"
echo "Output:  $out_dir"
exit "$oversize"
