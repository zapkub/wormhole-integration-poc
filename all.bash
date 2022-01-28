#!/usr/bin/env bash
set -e

build() {
  cargo build-bpf;
}

deploy() {
  solana program deploy /Users/rungsikornrungsikavarnich/Repositories/poc-wormhole-integration/target/deploy/bpf_program_template.so -k ~/.config/solana/dev.json
}

generate() {
  cargo generate --git https://github.com/mvines/solana-bpf-program-template
}

usage() {
  cat <<EOUSAGE
Usage information:
  generate        - generate new sub program in project
EOUSAGE
}

main() {

  case "$1" in
  "-h" | "--help" | "help")
    usage
    exit 0
    ;;
  generate) generate;;
  deploy) deploy;;
  build) build;;
  esac
}

main "$@"
