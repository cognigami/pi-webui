package main

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"flag"
	"fmt"
	"io"
	"log"
	"net"
	"net/http"
	"os"
	"os/signal"
	"strconv"
	"syscall"
	"time"

	"rai/internal/bridge"
	"rai/internal/catalog"
	"rai/internal/config"
	"rai/internal/web"
)

func main() {
	if err := run(os.Args[1:]); err != nil {
		log.Print(err)
		os.Exit(1)
	}
}
func run(args []string) error {
	if len(args) == 0 {
		return fmt.Errorf("usage: rai serve|send|stop -config PATH (send reads exact text from stdin)")
	}
	command := args[0]
	flags := flag.NewFlagSet(command, flag.ContinueOnError)
	path := flags.String("config", "", "JSON configuration file")
	endpoint := flags.String("endpoint", "", "fresh diagnostic endpoint ID")
	association := flags.String("association", "", "fresh conversation association ID")
	if err := flags.Parse(args[1:]); err != nil {
		return err
	}
	if flags.NArg() != 0 {
		return fmt.Errorf("unexpected positional arguments")
	}
	c, err := config.Load(*path)
	if err != nil {
		return err
	}
	ctx, cancel := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer cancel()
	switch command {
	case "serve":
		l, err := config.ListenPrivate(c.Socket)
		if err != nil {
			return err
		}
		defer l.Close()
		authority := net.JoinHostPort(c.Address, strconv.Itoa(c.Port))
		httpListener, err := net.Listen("tcp", authority)
		if err != nil {
			return err
		}
		defer httpListener.Close()
		server := bridge.New()
		httpServer := &http.Server{Handler: web.Diagnostic(server, authority, catalog.Command), ReadHeaderTimeout: 5 * time.Second, WriteTimeout: 10 * time.Second, IdleTimeout: 30 * time.Second}
		done := make(chan error, 1)
		go func() { done <- httpServer.Serve(httpListener) }()
		go func() { <-ctx.Done(); httpServer.Close() }()
		log.Printf("RAI diagnostic on http://%s; private bridge %s", authority, c.Socket)
		bridgeDone := make(chan error, 1)
		go func() { bridgeDone <- server.Serve(ctx, l) }()
		select {
		case err = <-done:
			cancel()
			<-bridgeDone
			if err == http.ErrServerClosed {
				return nil
			}
			return err
		case err = <-bridgeDone:
			cancel()
			httpServer.Close()
			<-done
			return err
		}
	case "send", "stop":
		if *endpoint == "" || *association == "" {
			return fmt.Errorf("endpoint and association are required; labels are not targets")
		}
		var token [16]byte
		if _, err := rand.Read(token[:]); err != nil {
			return err
		}
		req := bridge.Control{Type: "control", Version: 1, Target: bridge.Target{EndpointID: *endpoint, AssociationID: *association}, RequestID: hex.EncodeToString(token[:]), Operation: command}
		if command == "send" {
			data, err := io.ReadAll(io.LimitReader(os.Stdin, 128*1024+1))
			if err != nil {
				return err
			}
			if len(data) > 128*1024 {
				return fmt.Errorf("message exceeds 128 KiB")
			}
			req.Text = string(data)
		}
		result, err := bridge.Client(ctx, c.Socket, req)
		if err != nil {
			return err
		}
		return json.NewEncoder(os.Stdout).Encode(result)
	default:
		return fmt.Errorf("unknown command %q", command)
	}
}
