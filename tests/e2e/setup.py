"""Creates the throwaway TLS certificate and fake pin images used by the end-to-end test.
Output goes to tests/e2e/.work/ (git-ignored)."""
import colorsys, os, subprocess
from PIL import Image, ImageDraw, ImageFont

WORK = os.path.join(os.path.dirname(os.path.abspath(__file__)), '.work')
IMG = os.path.join(WORK, 'img')
os.makedirs(IMG, exist_ok=True)
subprocess.run(['openssl', 'req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-keyout', os.path.join(WORK, 'key.pem'),
                '-out', os.path.join(WORK, 'cert.pem'), '-days', '30', '-subj', '/CN=www.pinterest.com',
                '-addext', 'subjectAltName=DNS:www.pinterest.com,DNS:i.pinimg.com'], check=True, capture_output=True)
try:
    font = ImageFont.truetype('/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf', 90)
except OSError:
    font = ImageFont.load_default()
for i, pid in enumerate(['1001', '1002', '1003', '1004', '1005', '2001', '2002', '30011', '30012', '3002']):
    r, g, b = [int(c * 255) for c in colorsys.hls_to_rgb((i * 0.097) % 1, 0.42, 0.35)]
    img = Image.new('RGB', (1200, 1500 + (i % 3) * 300), (r, g, b))
    d = ImageDraw.Draw(img)
    d.text((80, 80), f'PIN {pid}', font=font, fill=(255, 255, 255))
    d.text((80, 200), 'original', font=font, fill=(255, 255, 255))
    img.save(os.path.join(IMG, f'{pid}-orig.jpg'), quality=85)
    img.save(os.path.join(IMG, f'{pid}-orig.png'))
    img.resize((736, int(736 * img.height / 1200))).save(os.path.join(IMG, f'{pid}-736.jpg'), quality=80)
    img.resize((236, int(236 * img.height / 1200))).save(os.path.join(IMG, f'{pid}-236.jpg'), quality=75)
print('test assets written to', WORK)
