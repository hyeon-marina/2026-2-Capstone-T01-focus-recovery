#!/usr/bin/env python3
"""Authenticated operator console. Never prints issued credentials or page content."""
import argparse
import json
import os
from pathlib import Path
import sys
import urllib.error
import urllib.parse
import urllib.request


def write_secret(path, value):
    fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    with os.fdopen(fd, 'w', encoding='utf-8') as out:
        json.dump(value, out, ensure_ascii=False, indent=2)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--server', required=True)
    parser.add_argument('--credential-file', type=Path, required=True)
    parser.add_argument('--synthetic-loopback', action='store_true')
    parser.add_argument('command', choices=['init', 'plan', 'save-plan', 'progress', 'enroll', 'issue', 'revoke', 'review', 'audit'])
    parser.add_argument('--input', type=Path)
    parser.add_argument('--participant')
    parser.add_argument('--credential-id')
    parser.add_argument('--attempt')
    parser.add_argument('--output', type=Path)
    args = parser.parse_args()
    u = urllib.parse.urlsplit(args.server)
    if u.path or u.query or u.fragment or u.username or u.password or not u.hostname or not (
        u.scheme == 'https' or args.synthetic_loopback and u.scheme == 'http' and u.hostname == '127.0.0.1'
    ):
        parser.error('HTTPS origin required; explicit synthetic exception is 127.0.0.1 only')
    credential = json.loads(args.credential_file.read_text(encoding='utf-8'))['credential']
    if args.command == 'issue' and (not args.output or args.output.exists()):
        parser.error('issue requires a new --output file; credential plaintext is never printed')
    body = json.loads(args.input.read_text(encoding='utf-8')) if args.input else None
    route = {
        'init': ('POST', '/plan/initialize'), 'plan': ('GET', '/plan'), 'save-plan': ('PUT', '/plan'),
        'progress': ('GET', '/progress'), 'enroll': ('POST', '/participants'),
        'issue': ('POST', f'/participants/{args.participant}/credentials'),
        'revoke': ('POST', f'/credentials/{args.credential_id}/revoke'),
        'review': ('POST', f'/attempts/{args.attempt}/review'), 'audit': ('GET', '/audit'),
    }
    if args.command in ['save-plan', 'enroll', 'issue', 'revoke', 'review'] and body is None:
        parser.error('--input JSON file required')
    for key in [args.participant, args.credential_id, args.attempt]:
        if key is not None and not all(c in 'abcdef0123456789-' for c in key):
            parser.error('Invalid resource identifier')
    method, path = route[args.command]
    request = urllib.request.Request(args.server + '/api/collection/admin' + path,
        data=json.dumps(body).encode() if body is not None else b'{}' if method == 'POST' else None,
        method=method, headers={'Authorization': 'Bearer ' + credential, 'Content-Type': 'application/json'})
    # No redirects: credentials must never follow a service redirect to another origin.
    class NoRedirect(urllib.request.HTTPRedirectHandler):
        def redirect_request(self, *unused):
            return None
    try:
        with urllib.request.build_opener(NoRedirect).open(request, timeout=30) as response:
            raw = response.read()
        result = json.loads(raw) if raw else {'status': 'OK'}
        if args.command == 'issue':
            write_secret(args.output, result)
            print(json.dumps({'participantId': result['participantId'], 'expiresAt': result['expiresAt'], 'credentialSaved': str(args.output)}))
        elif args.output:
            args.output.write_text(json.dumps(result, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
        else:
            print(json.dumps(result, ensure_ascii=False, indent=2))
        return 0
    except urllib.error.HTTPError as exc:
        print(f'HTTP {exc.code}: 요청 거절. 관리자 권한·인증 만료·입력·서버 감사 이력을 확인하세요.', file=sys.stderr)
        return 1
    except (OSError, ValueError, KeyError):
        print('요청/파일 처리 실패. 발급 응답이 유실되었다면 재발급하여 이전 Credential을 폐기하세요.', file=sys.stderr)
        return 1


if __name__ == '__main__':
    raise SystemExit(main())
