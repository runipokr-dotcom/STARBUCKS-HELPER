#!/usr/bin/env python3
"""STARBUCKS HELPER local MD downloader v1.1 (2026-09-03).

Listens only on 127.0.0.1 and saves extracted product assets below the fixed
Downloads/스타벅스MD directory. Uses only the Python standard library.
"""

from __future__ import annotations

import json
import html as html_module
import mimetypes
import os
import re
import shutil
import signal
import subprocess
import tempfile
import urllib.error
import urllib.parse
import urllib.request
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path


HOST = "127.0.0.1"
PORT = int(os.environ.get("STARBUCKS_HELPER_PORT", "17832"))
SAVE_ROOT = Path(os.environ.get("STARBUCKS_HELPER_SAVE_ROOT", Path.home() / "Downloads" / "스타벅스MD"))
ALLOWED_ORIGINS = {
    "https://runipokr-dotcom.github.io",
    "http://127.0.0.1:8000",
    "http://localhost:8000",
    "null",
}
USER_AGENT = (
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
    "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126 Safari/537.36"
)
MAX_PAGE_BYTES = 5 * 1024 * 1024
MAX_IMAGE_BYTES = 30 * 1024 * 1024
MUSINSA_HOSTS = {"musinsa.com", "www.musinsa.com"}
MUSINSA_SHORT_HOST = "musinsa.onelink.me"


class ExtractionError(Exception):
    pass


def resolve_musinsa_short_url(url: str) -> str:
    request = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
    try:
        with urllib.request.urlopen(request, timeout=20) as response:
            resolved = response.geturl()
    except (urllib.error.HTTPError, urllib.error.URLError) as exc:
        raise ExtractionError("무신사 공유링크를 열 수 없습니다.") from exc
    parsed = urllib.parse.urlsplit(resolved)
    if parsed.scheme != "https" or parsed.hostname not in MUSINSA_HOSTS:
        raise ExtractionError("무신사 공유링크의 실제 상품주소를 확인할 수 없습니다.")
    return resolved


def validate_product_url(value: str) -> tuple[str, str]:
    try:
        parsed = urllib.parse.urlsplit(value.strip())
    except ValueError as exc:
        raise ExtractionError("올바른 URL을 입력해주세요.") from exc
    if parsed.scheme != "https":
        raise ExtractionError("HTTPS 상품 주소를 입력해주세요.")
    if parsed.hostname == MUSINSA_SHORT_HOST:
        if not re.fullmatch(r"/PvkC/[A-Za-z0-9_-]+/?", parsed.path):
            raise ExtractionError("무신사 공유링크 형식이 아닙니다.")
        short_url = urllib.parse.urlunsplit(
            (parsed.scheme, parsed.netloc, parsed.path, parsed.query, "")
        )
        value = resolve_musinsa_short_url(short_url)
        parsed = urllib.parse.urlsplit(value)
    if parsed.hostname == "www.starbucks.co.kr":
        if parsed.path != "/menu/product_view.do":
            raise ExtractionError("스타벅스 상품 상세페이지 URL 형식이 아닙니다.")
        product_codes = urllib.parse.parse_qs(parsed.query).get("product_cd", [])
        if len(product_codes) != 1 or not re.fullmatch(r"\d+", product_codes[0]):
            raise ExtractionError("URL의 product_cd를 확인해주세요.")
        return "starbucks", urllib.parse.urlunsplit((parsed.scheme, parsed.netloc, parsed.path, parsed.query, ""))
    if parsed.hostname in MUSINSA_HOSTS:
        match = re.fullmatch(r"/products/(\d+)/?", parsed.path)
        if not match:
            raise ExtractionError("무신사 상품 상세페이지 URL 형식이 아닙니다.")
        return "musinsa", f"https://www.musinsa.com/products/{match.group(1)}"
    raise ExtractionError("스타벅스 공식 홈페이지 또는 무신사 상품 주소만 사용할 수 있습니다.")


def fetch_bytes(url: str, limit: int, referer: str | None = None) -> tuple[bytes, str]:
    headers = {
        "User-Agent": USER_AGENT,
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8",
        "Accept-Language": "ko-KR,ko;q=0.9,en-US;q=0.8,en;q=0.7",
        "Cache-Control": "no-cache",
        "Pragma": "no-cache",
        "Sec-Fetch-Dest": "document" if not referer else "image",
        "Sec-Fetch-Mode": "navigate" if not referer else "no-cors",
        "Sec-Fetch-Site": "none" if not referer else "same-site",
        "Upgrade-Insecure-Requests": "1",
    }
    if referer:
        headers["Referer"] = referer
    request = urllib.request.Request(url, headers=headers)
    try:
        with urllib.request.urlopen(request, timeout=30) as response:
            data = response.read(limit + 1)
            if len(data) > limit:
                raise ExtractionError("다운로드 파일이 허용 크기를 초과했습니다.")
            return data, response.headers.get_content_type()
    except urllib.error.HTTPError as exc:
        hostname = urllib.parse.urlsplit(url).hostname
        if exc.code == 403 and hostname in {"www.musinsa.com", "musinsa.com", "image.msscdn.net"}:
            command = [
                "/usr/bin/curl", "-L", "--fail", "--silent", "--show-error",
                "--max-filesize", str(limit), "-A", USER_AGENT,
                "-H", "Accept-Language: ko-KR,ko;q=0.9", url,
            ]
            if referer:
                command[-1:-1] = ["-e", referer]
            result = subprocess.run(command, capture_output=True, check=False)
            if result.returncode == 0 and len(result.stdout) <= limit:
                guessed = mimetypes.guess_type(urllib.parse.urlsplit(url).path)[0]
                return result.stdout, guessed or "application/octet-stream"
        raise ExtractionError(f"상품 페이지 응답 오류: HTTP {exc.code}") from exc
    except urllib.error.URLError as exc:
        raise ExtractionError("상품 페이지에 연결할 수 없습니다.") from exc


def extract_balanced(source: str, marker: str, opener: str, closer: str) -> str:
    marker_index = source.find(marker)
    if marker_index < 0:
        raise ExtractionError("상품 데이터 구조를 찾을 수 없습니다.")
    start = source.find(opener, marker_index + len(marker))
    if start < 0:
        raise ExtractionError("상품 데이터 시작점을 찾을 수 없습니다.")
    depth = 0
    in_string = False
    escaped = False
    for index in range(start, len(source)):
        char = source[index]
        if in_string:
            if escaped:
                escaped = False
            elif char == "\\":
                escaped = True
            elif char == '"':
                in_string = False
            continue
        if char == '"':
            in_string = True
        elif char == opener:
            depth += 1
        elif char == closer:
            depth -= 1
            if depth == 0:
                return source[start : index + 1]
    raise ExtractionError("상품 데이터 끝점을 찾을 수 없습니다.")


def parse_product(html: str) -> tuple[str, str, list[str]]:
    try:
        view = json.loads(extract_balanced(html, "view: remapView", "{", "}"))
        files = json.loads(extract_balanced(html, "file: remapFile", "[", "]"))
    except json.JSONDecodeError as exc:
        raise ExtractionError("상품 데이터를 해석할 수 없습니다.") from exc

    name = str(view.get("PRODUCT_NM") or "").strip()
    description = str(view.get("RECOMMEND") or "").replace("\r\n", "\n").strip()
    if not name:
        raise ExtractionError("상품명을 찾을 수 없습니다.")
    if not description:
        raise ExtractionError("하단 상품 설명을 찾을 수 없습니다.")

    ordered = sorted(files, key=lambda item: int(item.get("IMG_ORDER") or 999999))
    image_urls: list[str] = []
    seen: set[str] = set()
    for item in ordered:
        path = str(item.get("FILE_PATH") or "").strip()
        base = str(item.get("IMG_UPLOAD_PATH") or "https://image.istarbucks.co.kr").strip()
        if not path:
            continue
        url = urllib.parse.urljoin(base.rstrip("/") + "/", path.lstrip("/"))
        parsed = urllib.parse.urlsplit(url)
        if parsed.scheme != "https" or parsed.hostname != "image.istarbucks.co.kr":
            continue
        if "/upload/store/skuimg/" not in parsed.path or url in seen:
            continue
        seen.add(url)
        image_urls.append(url)
    if not image_urls:
        raise ExtractionError("상품 원본 이미지를 찾을 수 없습니다.")
    return name, description, image_urls


def musinsa_large_image(path: str) -> str:
    if path.startswith("//"):
        path = "https:" + path
    elif path.startswith("/"):
        path = "https://image.msscdn.net/thumbnails" + path
    if not path.startswith("https://image.msscdn.net/"):
        return ""
    path = re.sub(r"_500(?=\.(?:jpe?g|png|webp)$)", "_big", path, flags=re.I)
    return path + ("&" if "?" in path else "?") + "w=1200"


def parse_musinsa_product(page_html: str) -> tuple[str, str, int, list[str]]:
    try:
        state = json.loads(extract_balanced(page_html, "window.__MSS_FE__.product.state", "{", "}"))
    except json.JSONDecodeError as exc:
        raise ExtractionError("무신사 상품 데이터를 해석할 수 없습니다.") from exc
    name = str(state.get("goodsNm") or "").strip()
    price_data = state.get("goodsPrice") if isinstance(state.get("goodsPrice"), dict) else {}
    price = int(price_data.get("salePrice") or price_data.get("normalPrice") or 0)
    brand = state.get("brandInfo") if isinstance(state.get("brandInfo"), dict) else {}
    description = str(state.get("headDesc") or brand.get("memo") or "").strip()
    candidates = [str(state.get("thumbnailImageUrl") or "")]
    for item in state.get("goodsImages") or []:
        if isinstance(item, dict):
            candidates.append(str(item.get("imageUrl") or ""))
    images: list[str] = []
    for candidate in candidates:
        image_url = musinsa_large_image(candidate)
        if image_url and image_url not in images:
            images.append(image_url)
        if len(images) >= 5:
            break
    if not name:
        raise ExtractionError("무신사 상품명을 찾을 수 없습니다.")
    if not images:
        raise ExtractionError("무신사 상품 갤러리 이미지를 찾을 수 없습니다.")
    return name, description, price, images


def safe_folder_name(name: str) -> str:
    cleaned = re.sub(r"[/:*?\"<>|\\\x00-\x1f]", " ", name)
    cleaned = re.sub(r"\s+", " ", cleaned).strip(" .")
    return cleaned[:120] or "이름 없는 상품"


def available_destination(name: str) -> Path:
    SAVE_ROOT.mkdir(parents=True, exist_ok=True)
    base = SAVE_ROOT / safe_folder_name(name)
    if not base.exists():
        return base
    for number in range(2, 10000):
        candidate = SAVE_ROOT / f"{base.name} ({number})"
        if not candidate.exists():
            return candidate
    raise ExtractionError("같은 이름의 상품 폴더가 너무 많습니다.")


def extension_for(url: str, content_type: str) -> str:
    suffix = Path(urllib.parse.unquote(urllib.parse.urlsplit(url).path)).suffix.lower()
    if re.fullmatch(r"\.(?:jpe?g|png|webp|gif|avif)", suffix):
        return ".jpg" if suffix == ".jpeg" else suffix
    guessed = mimetypes.guess_extension(content_type) or ".img"
    return ".jpg" if guessed == ".jpe" else guessed


def extract_product(url: str) -> dict[str, object]:
    source, normalized_url = validate_product_url(url)
    page_bytes, _ = fetch_bytes(normalized_url, MAX_PAGE_BYTES)
    html = page_bytes.decode("utf-8", errors="replace")
    if source == "musinsa":
        name, description, price, image_urls = parse_musinsa_product(html)
    else:
        name, description, image_urls = parse_product(html)
        price = 0
    destination = available_destination(name)
    temporary = Path(tempfile.mkdtemp(prefix=".starbucks-md-", dir=SAVE_ROOT))
    try:
        saved_files: list[str] = []
        for index, image_url in enumerate(image_urls, 1):
            image_bytes, content_type = fetch_bytes(image_url, MAX_IMAGE_BYTES, normalized_url)
            extension = extension_for(image_url, content_type)
            filename = f"{index:02d}{extension}"
            (temporary / filename).write_bytes(image_bytes)
            saved_files.append(filename)
        info = f"상품명\n{name}\n\n"
        if price:
            info += f"판매가\n{price:,}원\n\n"
        info += f"하단 설명\n{description}\n\n원본 URL\n{normalized_url}\n"
        (temporary / "상품정보.txt").write_text(info, encoding="utf-8")
        temporary.rename(destination)
    except Exception:
        shutil.rmtree(temporary, ignore_errors=True)
        raise
    return {
        "productName": name,
        "description": description,
        "price": price,
        "imageCount": len(saved_files),
        "imageUrls": image_urls,
        "files": saved_files + ["상품정보.txt"],
        "folderName": destination.name,
        "folder": str(destination),
        "sourceUrl": normalized_url,
        "source": source,
    }


def local_page(result: dict[str, object] | None = None, error: str = "") -> bytes:
    result_html = ""
    if result:
        result_html = f"""
        <section class="result"><h2>{html_module.escape(str(result['productName']))}</h2>
        <dl><dt>이미지</dt><dd>{result['imageCount']}개</dd>
        <dt>저장 폴더</dt><dd>{html_module.escape(str(result['folder']))}</dd>
        <dt>하단 설명</dt><dd>{html_module.escape(str(result['description'])).replace(chr(10), '<br>')}</dd></dl></section>"""
    error_html = f'<p class="error">{html_module.escape(error)}</p>' if error else ""
    return f"""<!doctype html><html lang="ko"><head><meta charset="utf-8">
    <meta name="viewport" content="width=device-width,initial-scale=1">
    <title>스타벅스 MD 추출 | STARBUCKS HELPER</title><style>
    :root{{font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;--green:#00754a;--dark:#063c2d;--bg:#f3f5f3;--line:#dfe5e1;--text:#18201c;--muted:#6a766f}}*{{box-sizing:border-box}}body{{margin:0;background:var(--bg);color:var(--text)}}header{{padding:28px 20px 54px;background:var(--dark);color:#fff}}.head,main{{width:min(100%,720px);margin:auto}}h1{{margin:0 0 8px;font-size:34px}}header p{{margin:0;color:#c8ddd3}}main{{margin-top:-28px;padding:0 14px 30px}}.card,.result{{padding:20px;border:1px solid var(--line);border-radius:22px;background:#fff;box-shadow:0 10px 28px #122e2212}}label{{display:block;margin-bottom:9px;font-weight:800}}input,button{{width:100%;height:52px;border-radius:14px;font:inherit}}input{{border:1px solid var(--line);padding:0 14px}}button{{margin-top:12px;border:0;background:var(--green);color:#fff;font-weight:850}}.path{{padding:12px;border-radius:12px;background:#dff2e8;color:#25513e;font-size:12px;word-break:break-all}}.error{{padding:12px;border-radius:12px;background:#fff1ef;color:#9d241d}}.result{{margin-top:14px}}.result h2{{margin-top:0}}dl{{display:grid;grid-template-columns:76px 1fr;gap:8px;font-size:13px}}dt{{color:var(--muted);font-weight:750}}dd{{margin:0;word-break:break-all}}
    </style></head><body><header><div class="head"><h1>스타벅스 MD 추출</h1><p>스타벅스 공식 홈페이지 무신사 상품 주소를 지원합니다.</p></div></header>
    <main><section class="card"><form action="/extract-form" method="post"><label for="url">상품 상세 URL</label>
    <input id="url" name="url" type="url" required placeholder="스타벅스 공식 또는 무신사 상품/공유 링크">
    <button type="submit">상품 정보와 이미지 저장</button></form>
    <p class="path">저장 위치<br>{html_module.escape(str(SAVE_ROOT))}/상품명/</p>{error_html}</section>{result_html}</main></body></html>""".encode("utf-8")


class Handler(BaseHTTPRequestHandler):
    server_version = "StarbucksMDHelper/1.1"

    def log_message(self, format: str, *args: object) -> None:
        print(f"[{self.log_date_time_string()}] {format % args}")

    def allowed_origin(self) -> str | None:
        origin = self.headers.get("Origin")
        return origin if origin in ALLOWED_ORIGINS else None

    def add_cors_headers(self) -> None:
        origin = self.allowed_origin()
        if origin:
            self.send_header("Access-Control-Allow-Origin", origin)
            self.send_header("Vary", "Origin")
        self.send_header("Access-Control-Allow-Private-Network", "true")

    def send_json(self, status: int, payload: dict[str, object]) -> None:
        body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.add_cors_headers()
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def send_html(self, status: int, body: bytes) -> None:
        self.send_response(status)
        self.send_header("Content-Type", "text/html; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_OPTIONS(self) -> None:
        if not self.allowed_origin():
            self.send_json(403, {"ok": False, "error": "허용되지 않은 요청입니다."})
            return
        self.send_response(204)
        self.add_cors_headers()
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")
        self.send_header("Content-Length", "0")
        self.end_headers()

    def do_GET(self) -> None:
        if self.path == "/":
            self.send_html(200, local_page())
        elif self.path == "/health":
            self.send_json(200, {"ok": True, "version": "1.1", "saveRoot": str(SAVE_ROOT)})
        elif self.path.startswith("/media/"):
            self.serve_media()
        else:
            self.send_json(404, {"ok": False, "error": "찾을 수 없습니다."})

    def serve_media(self) -> None:
        # Serves previously downloaded product images from SAVE_ROOT so the
        # web editor can draw them onto a <canvas> without CORS tainting
        # (fixes Musinsa images failing to render in the JPG export).
        try:
            raw_path = self.path[len("/media/"):].split("?", 1)[0]
            relative = urllib.parse.unquote(raw_path)
            if not relative or ".." in Path(relative).parts:
                raise FileNotFoundError
            target = (SAVE_ROOT / relative).resolve()
            target.relative_to(SAVE_ROOT.resolve())
            if not target.is_file():
                raise FileNotFoundError
        except (FileNotFoundError, ValueError):
            self.send_json(404, {"ok": False, "error": "이미지를 찾을 수 없습니다."})
            return
        content_type = mimetypes.guess_type(str(target))[0] or "application/octet-stream"
        data = target.read_bytes()
        self.send_response(200)
        self.add_cors_headers()
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(data)))
        self.send_header("Cache-Control", "public, max-age=31536000, immutable")
        self.end_headers()
        self.wfile.write(data)

    def do_POST(self) -> None:
        if self.path == "/extract-form":
            try:
                length = int(self.headers.get("Content-Length") or "0")
                if length < 1 or length > 4096:
                    raise ExtractionError("요청 크기가 올바르지 않습니다.")
                values = urllib.parse.parse_qs(self.rfile.read(length).decode("utf-8"))
                result = extract_product(str((values.get("url") or [""])[0]))
                self.send_html(200, local_page(result=result))
            except ExtractionError as exc:
                self.send_html(400, local_page(error=str(exc)))
            except Exception as exc:
                print(f"Unexpected extraction error: {exc!r}")
                self.send_html(500, local_page(error="저장 중 오류가 발생했습니다."))
            return
        if self.path != "/extract":
            self.send_json(404, {"ok": False, "error": "찾을 수 없습니다."})
            return
        if not self.allowed_origin():
            self.send_json(403, {"ok": False, "error": "허용되지 않은 요청입니다."})
            return
        try:
            length = int(self.headers.get("Content-Length") or "0")
            if length < 1 or length > 4096:
                raise ExtractionError("요청 크기가 올바르지 않습니다.")
            payload = json.loads(self.rfile.read(length).decode("utf-8"))
            result = extract_product(str(payload.get("url") or ""))
            port = self.server.server_port
            result["mediaUrls"] = [
                f"http://{HOST}:{port}/media/{urllib.parse.quote(result['folderName'])}/{urllib.parse.quote(name)}"
                for name in result["files"]
                if name != "상품정보.txt"
            ]
            self.send_json(200, {"ok": True, **result})
        except ExtractionError as exc:
            self.send_json(400, {"ok": False, "error": str(exc)})
        except (json.JSONDecodeError, UnicodeDecodeError):
            self.send_json(400, {"ok": False, "error": "요청을 읽을 수 없습니다."})
        except Exception as exc:
            print(f"Unexpected extraction error: {exc!r}")
            self.send_json(500, {"ok": False, "error": "저장 중 오류가 발생했습니다."})


def main() -> None:
    SAVE_ROOT.mkdir(parents=True, exist_ok=True)
    server = ThreadingHTTPServer((HOST, PORT), Handler)
    signal.signal(signal.SIGTERM, lambda *_: server.shutdown())
    print(f"STARBUCKS HELPER MD downloader: http://{HOST}:{PORT}")
    print(f"Save root: {SAVE_ROOT}")
    server.serve_forever()


if __name__ == "__main__":
    main()
