set positional-arguments
export TMPDIR := invocation_directory() / ".rai-investigation/tmp"

build:
    mkdir -p bin "$TMPDIR"
    go build -o bin/rai ./cmd/rai
    ./node_modules/.bin/tsc --noEmit

lint *paths:
    #!/bin/sh
    set -eu
    mkdir -p "$TMPDIR"
    if [ "$#" -eq 0 ] || [ "$1" = "." ]; then
      gofmt -w cmd internal
      go vet ./...
      ./node_modules/.bin/biome check --write extensions/pi-webui internal/web/assets
    else
      for path do
        case "$path" in
          extensions/pi-webui/*|internal/web/assets/*) ./node_modules/.bin/biome check --write "$path" ;;
          *) gofmt -w "$path"; go vet ./... ;;
        esac
      done
    fi

test *paths: build
    #!/bin/sh
    set -eu
    mkdir -p "$TMPDIR"
    if [ "$#" -eq 0 ]; then
      go test -race ./...
      node --test extensions/pi-webui/*.test.ts internal/web/assets/*.test.js
    else
      case "$1" in
        extensions/pi-webui/*|internal/web/assets/*.test.js) node --test "$@" ;;
        *)
          for path do
            case "$path" in ./*) ;; *) path="./$path" ;; esac
            go test -race "$path"
          done
          ;;
      esac
    fi
