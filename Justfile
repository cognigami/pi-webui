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
      ./node_modules/.bin/biome check --write extension
    else
      for path do
        case "$path" in
          extension/*) ./node_modules/.bin/biome check --write "$path" ;;
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
      node --test extension/*.test.ts
    else
      case "$1" in
        extension/*) node --test "$@" ;;
        *)
          for path do
            case "$path" in ./*) ;; *) path="./$path" ;; esac
            go test -race "$path"
          done
          ;;
      esac
    fi
