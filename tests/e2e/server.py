"""Local stand-in for pinterest.com and i.pinimg.com, used only for end-to-end testing.
Chromium is pointed here with --host-resolver-rules, so no request reaches the real sites."""
import json, os, ssl, sys, urllib.parse
from http.server import ThreadingHTTPServer, BaseHTTPRequestHandler

HERE = os.path.join(os.path.dirname(os.path.abspath(__file__)), '.work')
IMG = os.path.join(HERE, 'img')
H = lambda pid: pid.zfill(32)
PIN = 'https://i.pinimg.com'

def url(size, pid, ext='jpg'):
    return f"{PIN}/{size}/00/00/00/{H(pid)}.{ext}"

TITLES = {
    '1001': 'Concrete spiral stair', '1002': 'Kitchen in walnut and steel', '1003': 'Brutalist reading nook',
    '1004': 'Lamp study, opal glass', '1005': 'Travertine bath', '2001': 'Black kitchen island',
    '2002': 'Oak slat kitchen wall', '3001': 'Pendant cluster (carousel)', '3002': 'Warm cove lighting',
}
ORIG_EXT = {'1003': 'png'}           # this original is a PNG while its thumbnail is a JPG
MISSING_ORIG = {'3002'}             # no original and no 1200x: must fall back to 736x

def pin_json(pid):
    p = {
        'id': pid, 'type': 'pin', 'title': TITLES[pid], 'description': f'Description of {TITLES[pid]}',
        'link': f'https://example.com/source/{pid}', 'pinner': {'username': 'studio.archive'},
        'board': {'name': 'Interior Refs'},
        'images': {'236x': {'url': url('236x', pid), 'width': 236, 'height': 300},
                   'orig': {'url': url('originals', pid, ORIG_EXT.get(pid, 'jpg')), 'width': 1200, 'height': 1500}},
    }
    if pid == '3001':
        p['images'] = {'236x': {'url': url('236x', '30011'), 'width': 236, 'height': 300}, 'orig': {'url': url('originals', '30011')}}
        p['carousel_data'] = {'carousel_slots': [
            {'images': {'orig': {'url': url('originals', '30011'), 'width': 1200, 'height': 1500}}},
            {'images': {'orig': {'url': url('originals', '30012'), 'width': 1200, 'height': 1800}}},
        ]}
    return p

UNSORTED = ['1001', '1002', '1003', '1004', '1005']
SECTIONS = {'S1': ('Kitchens', 'kitchens', ['2001', '2002']), 'S2': ('Lighting', 'lighting', ['3001', '3002'])}
LOG = []

def page(items, bookmark_key, opts, size=3):
    start = int((opts.get('bookmarks') or ['0'])[0] or 0)
    chunk = items[start:start + size]
    nxt = start + size
    bm = str(nxt) if nxt < len(items) else '-end-'
    return {'resource_response': {'data': [pin_json(i) for i in chunk], 'bookmark': bm}}

def api(name, opts):
    LOG.append(name)
    if name == 'BoardResource':
        return {'resource_response': {'data': {'id': 'B1', 'name': 'Interior Refs', 'pin_count': 9, 'section_count': 2, 'url': '/jane/interior-refs/'}}}
    if name == 'BoardFeedResource':
        items = UNSORTED if opts.get('filter_section_pins') else UNSORTED + SECTIONS['S1'][2] + SECTIONS['S2'][2]
        return page(items, 'b', opts)
    if name == 'BoardSectionsResource':
        return {'resource_response': {'data': [{'id': k, 'title': v[0], 'slug': v[1], 'pin_count': len(v[2])} for k, v in SECTIONS.items()], 'bookmark': '-end-'}}
    if name == 'BoardSectionPinsResource':
        return page(SECTIONS[opts['section_id']][2], 's', opts)
    if name == 'PinResource':
        return {'resource_response': {'data': pin_json(opts['id'])}}
    return {'resource_response': {'data': None, 'error': {'message': 'unknown'}}}

def card(pid, h):
    return f'''<div data-grid-item="true" class="gi"><div data-test-id="pin"><a href="/pin/{pid}/" aria-label="{TITLES[pid]}">
      <img src="{url('236x', '30011' if pid == '3001' else pid)}" alt="{TITLES[pid]}" style="height:{h}px"></a>
      <div class="t">{TITLES[pid]}</div></div></div>'''

def section_card(sid):
    title, slug, pins = SECTIONS[sid]
    imgs = ''.join(f'<img src="{url("236x", "30011" if p == "3001" else p)}">' for p in pins)
    return f'<a class="sec" href="/jane/interior-refs/{slug}/"><div class="cov">{imgs}</div><div class="st">{title}</div><div class="sc">{len(pins)} Pins</div></a>'

BOARD_HTML = '''<!doctype html><html><head><meta charset="utf-8"><title>Interior Refs</title><style>
body{margin:0;background:#111;color:#eee;font-family:system-ui,sans-serif}
header{height:80px;display:flex;align-items:center;padding:0 20px;gap:16px;border-bottom:1px solid #222}
.logo{width:32px;height:32px;border-radius:50%;background:#e60023}.search{flex:1;height:44px;border-radius:22px;background:#222;border:0;color:#eee;padding:0 16px}
h1{text-align:center;margin:24px 0 4px}.meta{text-align:center;color:#999;margin-bottom:12px}
.secs{display:flex;gap:12px;padding:0 24px 12px}.sec{width:180px;color:#eee;text-decoration:none}.cov{display:flex;gap:2px;height:110px;border-radius:14px;overflow:hidden}.cov img{flex:1;object-fit:cover;min-width:0}
.st{font-weight:600;margin-top:6px}.sc{color:#999;font-size:13px}
.grid{columns:5 220px;column-gap:16px;padding:16px 24px 200px}.gi{break-inside:avoid;margin-bottom:16px}.gi img{width:100%;object-fit:cover;border-radius:16px;display:block}.t{font-size:12px;color:#aaa;padding:6px 4px}
</style></head><body><header><div class="logo"></div><input class="search" placeholder="Search"></header>
<h1>Interior Refs</h1><div class="meta">9 pins · 2 sections</div><div class="secs">%SECS%</div><div class="grid" role="list">%CARDS%</div>
<script>document.querySelectorAll('a[href^="/pin/"]').forEach(a=>a.addEventListener('click',e=>{e.preventDefault();window.__navigated=(window.__navigated||0)+1;}))</script>
</body></html>'''

class Handler(BaseHTTPRequestHandler):
    def log_message(self, *a):
        pass

    def send(self, code, body, ctype):
        self.send_response(code)
        self.send_header('Content-Type', ctype)
        self.send_header('Content-Length', str(len(body)))
        self.send_header('Access-Control-Allow-Origin', '*')
        self.end_headers()
        if self.command != 'HEAD':
            self.wfile.write(body)

    def do_HEAD(self):
        self.do_GET()

    def do_GET(self):
        host = (self.headers.get('Host') or '').split(':')[0]
        u = urllib.parse.urlparse(self.path)
        if host == 'i.pinimg.com':
            parts = u.path.strip('/').split('/')
            if len(parts) == 5:
                size, name = parts[0], parts[4]
                h, ext = name.rsplit('.', 1)
                pid = h.lstrip('0')
                if size == 'originals':
                    if pid in MISSING_ORIG or ext != ORIG_EXT.get(pid, 'jpg'):
                        return self.send(404, b'no', 'text/plain')
                    f = os.path.join(IMG, f'{pid}-orig.{ext}')
                elif size == '1200x':
                    if pid in MISSING_ORIG:
                        return self.send(404, b'no', 'text/plain')
                    f = os.path.join(IMG, f'{pid}-orig.jpg')
                elif size == '736x':
                    f = os.path.join(IMG, f'{pid}-736.jpg')
                else:
                    f = os.path.join(IMG, f'{pid}-236.jpg')
                if os.path.exists(f):
                    return self.send(200, open(f, 'rb').read(), 'image/png' if f.endswith('png') else 'image/jpeg')
            return self.send(404, b'no', 'text/plain')
        if u.path.startswith('/resource/'):
            name = u.path.split('/')[2]
            q = urllib.parse.parse_qs(u.query)
            data = json.loads(q.get('data', ['{}'])[0])
            return self.send(200, json.dumps(api(name, data.get('options', {}))).encode(), 'application/json')
        if u.path == '/__log':
            return self.send(200, json.dumps(LOG).encode(), 'application/json')
        if u.path.startswith('/jane/interior-refs'):
            heights = [300, 220, 360, 260, 320]
            html = BOARD_HTML.replace('%SECS%', ''.join(section_card(s) for s in SECTIONS)).replace('%CARDS%', ''.join(card(p, heights[i]) for i, p in enumerate(UNSORTED)))
            return self.send(200, html.encode(), 'text/html; charset=utf-8')
        return self.send(404, b'<h1>not found</h1>', 'text/html')

if __name__ == '__main__':
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 8443
    srv = ThreadingHTTPServer(('127.0.0.1', port), Handler)
    ctx = ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER)
    ctx.load_cert_chain(os.path.join(HERE, 'cert.pem'), os.path.join(HERE, 'key.pem'))
    srv.socket = ctx.wrap_socket(srv.socket, server_side=True)
    print('serving', port, flush=True)
    srv.serve_forever()
