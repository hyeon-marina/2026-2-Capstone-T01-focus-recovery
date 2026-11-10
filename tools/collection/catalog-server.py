#!/usr/bin/env python3
"""Closed catalog matching fe/synthetic/catalog.ts, loopback only."""
from http.server import BaseHTTPRequestHandler, HTTPServer


class Catalog(BaseHTTPRequestHandler):
    def do_GET(self):
        fixture = self.path.rsplit('/', 1)[-1]
        if self.path != '/__focus_synthetic__/' + fixture or fixture not in ('a', 'b', 'c', 'd'):
            self.send_error(404)
            return
        self.send_response(200)
        self.send_header('Content-Type', 'text/html; charset=utf-8')
        self.end_headers()
        self.wfile.write((f'<!doctype html><html data-focus-synthetic="catalog-v1"><title>Synthetic fixture {fixture}</title><body><article>'
            f'Synthetic fixture {fixture}. This public example describes TypeScript transactions and durable page observations. No participant information is present.'
            '</article></body></html>').encode())

    def log_message(self, *args):
        pass


if __name__ == '__main__':
    print('Synthetic catalog: http://127.0.0.1:8911/__focus_synthetic__/a', flush=True)
    HTTPServer(('127.0.0.1', 8911), Catalog).serve_forever()
