"""Local dev server for the frontend on port 5500."""
import http.server, socketserver, os, socket, webbrowser

PORT = 5500
HERE = os.path.dirname(os.path.abspath(__file__))


def local_ip():
    try:
        s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        s.connect(("8.8.8.8", 80))
        ip = s.getsockname()[0]
        s.close()
        return ip
    except Exception:
        return "127.0.0.1"


class Handler(http.server.SimpleHTTPRequestHandler):
    def log_message(self, fmt, *args):
        print(f"  [{self.address_string()}] {fmt % args}")
    def end_headers(self):
        self.send_header("Cache-Control", "no-store, no-cache, must-revalidate")
        super().end_headers()


def main():
    os.chdir(HERE)
    with socketserver.ThreadingTCPServer(("", PORT), Handler) as httpd:
        httpd.daemon_threads = True
        print(f"\nTripWise frontend running at http://localhost:{PORT}")
        print(f"Network: http://{local_ip()}:{PORT}\n")
        try:
            webbrowser.open(f"http://localhost:{PORT}")
        except Exception:
            pass
        try:
            httpd.serve_forever()
        except KeyboardInterrupt:
            print("\nStopped.")


if __name__ == "__main__":
    main()