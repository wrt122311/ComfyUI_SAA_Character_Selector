import base64
import csv
import gzip
import hashlib
import io
import json
import re
import threading
import time
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path

from aiohttp import web
from server import PromptServer


CHAR_CSV_URL = "https://raw.githubusercontent.com/mirabarukaso/character_select_stand_alone_app/refs/heads/main/data/wai_characters.csv"
THUMBS_URL = "https://huggingface.co/datasets/flagrantia/character_select_stand_alone_app/resolve/main/wai_character_thumbs_v160.json?download=true"


def _sanitize_for_md5(text: str) -> str:
    return text.replace("\\", "\\\\").replace("(", r"\(").replace(")", r"\)")


def _escape_parens(text: str) -> str:
    return (text or "").replace("(", r"\(").replace(")", r"\)")


def _extract_origin(zh_name: str, en_name: str) -> str:
    candidates = []
    m_en = re.findall(r"\(([^()]*)\)", en_name or "")
    if m_en:
        candidates.extend([v.strip() for v in m_en if v.strip()])

    m_zh = re.findall(r"[（(]([^（）()]*)[）)]", zh_name or "")
    if m_zh:
        candidates.extend([v.strip() for v in m_zh if v.strip()])

    for c in reversed(candidates):
        lowered = c.lower()
        if lowered not in {"windows 95", "windows 98", "windows 2000", "windows 3.1"}:
            return c
    return candidates[-1] if candidates else "Unknown"


class _SAADataStore:
    def __init__(self):
        self.root = Path(__file__).resolve().parent
        self.legacy_cache_dir = self.root / "cache"
        self.characters_file = self.root / "wai_characters.csv"
        self.thumbs_file = self.root / "wai_character_thumbs_v160.json"
        self._migrate_legacy_cache()

        self._lock = threading.Lock()
        self._is_loading = False
        self._progress = 0
        self._status = "idle"
        self._error = ""
        self._loaded_at = 0.0

        self._characters = []
        self._char_by_id = {}
        self._char_by_md5 = {}
        self._groups = []
        self._group_counts = {}
        self._thumbs_map = {}
        self.favorites_file = self.root / "favorites.json"
        self._favorites = set()
        self._load_favorites()

    def _load_favorites(self):
        if self.favorites_file.exists():
            try:
                with open(self.favorites_file, "r", encoding="utf-8") as f:
                    self._favorites = set(json.load(f))
            except Exception:
                self._favorites = set()

    def _save_favorites(self):
        try:
            with open(self.favorites_file, "w", encoding="utf-8") as f:
                json.dump(list(self._favorites), f, ensure_ascii=False)
        except Exception:
            pass

    def toggle_favorite(self, char_id):
        with self._lock:
            if char_id in self._favorites:
                self._favorites.remove(char_id)
                res = False
            else:
                self._favorites.add(char_id)
                res = True
            self._save_favorites()
            return res

    def _migrate_legacy_cache(self):
        legacy_files = [
            (self.legacy_cache_dir / "wai_characters.csv", self.characters_file),
            (self.legacy_cache_dir / "wai_character_thumbs_v160.json", self.thumbs_file),
        ]
        for src, dst in legacy_files:
            if dst.exists() or not src.exists():
                continue
            try:
                src.replace(dst)
            except OSError:
                # If moving fails because files are on different volumes or locked,
                # leave the normal downloader to fill the root-level file once.
                pass

    def status(self):
        with self._lock:
            return {
                "is_loading": self._is_loading,
                "progress": self._progress,
                "status": self._status,
                "error": self._error,
                "loaded_at": self._loaded_at,
                "character_count": len(self._characters),
                "group_count": len(self._groups),
            }

    def ensure_loaded(self, force=False):
        with self._lock:
            if self._is_loading:
                return
            if self._characters and not force:
                return
            self._is_loading = True
            self._progress = 1
            self._status = "starting"
            self._error = ""

        try:
            self._download_if_needed(CHAR_CSV_URL, self.characters_file, force=force, progress_floor=1, progress_ceiling=30)
            self._download_if_needed(THUMBS_URL, self.thumbs_file, force=force, progress_floor=30, progress_ceiling=75)
            self._parse(progress_floor=75, progress_ceiling=100)
            with self._lock:
                self._progress = 100
                self._status = "ready"
                self._loaded_at = time.time()
                self._is_loading = False
        except Exception as exc:
            with self._lock:
                self._error = str(exc)
                self._status = "failed"
                self._is_loading = False

    def _set_progress(self, value, status):
        with self._lock:
            self._progress = max(0, min(100, int(value)))
            self._status = status

    def _download_if_needed(self, url, path: Path, force=False, progress_floor=0, progress_ceiling=100):
        if path.exists() and path.stat().st_size > 0 and not force:
            self._set_progress(progress_ceiling, f"using cache: {path.name}")
            return

        req = urllib.request.Request(url, headers={"User-Agent": "ComfyUI-SAA-Selector/1.0"})
        self._set_progress(progress_floor, f"downloading: {path.name}")
        with urllib.request.urlopen(req, timeout=120) as resp:
            total = resp.headers.get("Content-Length")
            total = int(total) if total and total.isdigit() else 0
            read = 0
            with open(path, "wb") as f:
                while True:
                    chunk = resp.read(1024 * 64)
                    if not chunk:
                        break
                    f.write(chunk)
                    read += len(chunk)
                    if total > 0:
                        ratio = read / total
                        progress = progress_floor + (progress_ceiling - progress_floor) * ratio
                        self._set_progress(progress, f"downloading: {path.name}")
        self._set_progress(progress_ceiling, f"downloaded: {path.name}")

    def _parse(self, progress_floor=0, progress_ceiling=100):
        self._set_progress(progress_floor, "parsing data")
        with open(self.characters_file, "r", encoding="utf-8-sig", newline="") as f:
            rows = list(csv.reader(f))

        with open(self.thumbs_file, "r", encoding="utf-8") as f:
            thumbs_map = json.load(f)

        chars = []
        by_id = {}
        by_md5 = {}
        groups = set()
        group_counts = {}
        total = max(1, len(rows))
        for idx, row in enumerate(rows):
            if len(row) < 2:
                continue
            zh_name = (row[0] or "").strip()
            en_name = (row[1] or "").strip()
            if not en_name:
                continue

            origin = _extract_origin(zh_name, en_name)
            md5_key = hashlib.md5(_sanitize_for_md5(en_name).encode("utf-8")).hexdigest()
            char_id = urllib.parse.quote(en_name, safe="")
            has_thumb = md5_key in thumbs_map
            item = {
                "id": char_id,
                "name_zh": zh_name,
                "name_en": en_name,
                "origin": origin,
                "thumb_key": md5_key,
                "has_thumb": has_thumb,
            }
            chars.append(item)
            by_id[char_id] = item
            by_md5[md5_key] = item
            groups.add(origin)
            group_counts[origin] = group_counts.get(origin, 0) + 1

            if idx % 80 == 0:
                ratio = idx / total
                progress = progress_floor + (progress_ceiling - progress_floor) * ratio
                self._set_progress(progress, "building index")

        chars.sort(key=lambda x: (x["origin"].lower(), x["name_en"].lower()))
        group_list = ["All"] + sorted(groups, key=lambda x: x.lower())

        with self._lock:
            self._characters = chars
            self._char_by_id = by_id
            self._char_by_md5 = by_md5
            self._groups = group_list
            self._group_counts = group_counts
            self._thumbs_map = thumbs_map

        self._set_progress(progress_ceiling, "index ready")

    def list_groups(self):
        with self._lock:
            return list(self._groups)

    def list_groups_with_count(self):
        with self._lock:
            groups = list(self._groups)
            counts = dict(self._group_counts)
            total = len(self._characters)
        result = []
        for g in groups:
            if g == "All":
                result.append({"name": g, "count": total})
            else:
                result.append({"name": g, "count": counts.get(g, 0)})
        return result

    def list_characters(self, search="", group="All", limit=120, favorites_only=False):
        with self._lock:
            chars = self._characters
            favs = self._favorites
        q = (search or "").strip().lower()
        result = []
        for item in chars:
            if favorites_only and item["id"] not in favs:
                continue
            if group and group != "All" and item["origin"] != group:
                continue
            if q:
                if q not in item["name_en"].lower() and q not in item["name_zh"].lower() and q not in item["origin"].lower():
                    continue
            result.append(
                {
                    "id": item["id"],
                    "name_zh": item["name_zh"],
                    "name_en": item["name_en"],
                    "origin": item["origin"],
                    "thumb_url": f"/saa_selector/thumb/{item['id']}",
                    "is_favorite": item["id"] in favs,
                }
            )
            if len(result) >= limit:
                break
        return result

    def get_character(self, char_id):
        item = self._resolve_character(char_id)
        if not item:
            return None
        return {
            "id": item["id"],
            "name_zh": item["name_zh"],
            "name_en": item["name_en"],
            "origin": item["origin"],
            "thumb_url": f"/saa_selector/thumb/{item['id']}",
        }

    def get_character_output(self, char_id):
        item = self._resolve_character(char_id)
        if not item:
            return {
                "name_zh": "",
                "name_en": "",
                "origin": "",
                "prompt": "",
                "json": json.dumps({"error": "no character selected"}, ensure_ascii=False),
            }
        # The second column in wai_characters.csv is the generation prompt/tag.
        prompt = _escape_parens(item["name_en"])
        name_en_escaped = _escape_parens(item["name_en"])
        payload = {
            "id": item["id"],
            "name_zh": item["name_zh"],
            "name_en": name_en_escaped,
            "origin": item["origin"],
            "prompt": prompt,
            "thumb_url": f"/saa_selector/thumb/{item['id']}",
        }
        return {
            "name_zh": item["name_zh"],
            "name_en": name_en_escaped,
            "origin": item["origin"],
            "prompt": prompt,
            "json": json.dumps(payload, ensure_ascii=False),
        }

    def get_thumb_bytes(self, char_id):
        item = self._resolve_character(char_id)
        with self._lock:
            thumbs = self._thumbs_map
        if not item:
            return None
        packed = thumbs.get(item["thumb_key"])
        if not packed:
            return None
        raw = base64.b64decode(packed)
        return gzip.decompress(raw)

    def _resolve_character(self, char_id):
        with self._lock:
            by_id = self._char_by_id
            by_md5 = self._char_by_md5

        if not char_id:
            return None

        item = by_id.get(char_id)
        if item:
            return item

        # AIOHTTP path params may arrive decoded; support both forms.
        encoded = urllib.parse.quote(char_id, safe="")
        item = by_id.get(encoded)
        if item:
            return item

        decoded = urllib.parse.unquote(char_id)
        item = by_id.get(decoded)
        if item:
            return item

        # Fallback to md5 key if frontend ever sends md5 id directly.
        return by_md5.get(char_id)


STORE = _SAADataStore()


@PromptServer.instance.routes.get("/saa_selector/status")
async def saa_selector_status(request):
    return web.json_response(STORE.status())


@PromptServer.instance.routes.post("/saa_selector/reload")
async def saa_selector_reload(request):
    threading.Thread(target=STORE.ensure_loaded, kwargs={"force": True}, daemon=True).start()
    return web.json_response({"ok": True})


@PromptServer.instance.routes.get("/saa_selector/groups")
async def saa_selector_groups(request):
    STORE.ensure_loaded(force=False)
    return web.json_response({"groups": STORE.list_groups_with_count()})


@PromptServer.instance.routes.get("/saa_selector/characters")
async def saa_selector_characters(request):
    STORE.ensure_loaded(force=False)
    search = request.query.get("search", "")
    group = request.query.get("group", "All")
    fav_only = request.query.get("favorites_only", "false").lower() == "true"
    try:
        limit = int(request.query.get("limit", "120"))
    except ValueError:
        limit = 120
    limit = max(1, min(600, limit))
    items = STORE.list_characters(search=search, group=group, limit=limit, favorites_only=fav_only)
    return web.json_response({"items": items})

@PromptServer.instance.routes.post("/saa_selector/favorite/{char_id}")
async def saa_selector_toggle_favorite(request):
    STORE.ensure_loaded(force=False)
    char_id = request.match_info.get("char_id", "")
    item = STORE._resolve_character(char_id)
    if not item:
        return web.json_response({"error": "not found"}, status=404)
    real_id = item["id"]
    is_fav = STORE.toggle_favorite(real_id)
    return web.json_response({"id": real_id, "is_favorite": is_fav})


@PromptServer.instance.routes.get("/saa_selector/character/{char_id}")
async def saa_selector_character(request):
    STORE.ensure_loaded(force=False)
    char_id = request.match_info.get("char_id", "")
    item = STORE.get_character(char_id)
    if not item:
        return web.json_response({"error": "not found"}, status=404)
    return web.json_response(item)


@PromptServer.instance.routes.get("/saa_selector/thumb/{char_id}")
async def saa_selector_thumb(request):
    STORE.ensure_loaded(force=False)
    char_id = request.match_info.get("char_id", "")
    thumb = STORE.get_thumb_bytes(char_id)
    if not thumb:
        return web.Response(status=404, text="thumb not found")
    return web.Response(body=thumb, content_type="image/webp")


class SAACharacterSelector:
    @classmethod
    def INPUT_TYPES(cls):
        STORE.ensure_loaded(force=False)
        groups = STORE.list_groups()
        if not groups:
            groups = ["All"]
        return {
            "required": {
                "selected_character_id": ("STRING", {"default": "", "multiline": False}),
                "source_group": (groups, {"default": "All"}),
                "auto_refresh_data": ("BOOLEAN", {"default": False}),
            },
        }

    RETURN_TYPES = ("STRING", "STRING", "STRING", "STRING", "STRING")
    RETURN_NAMES = ("character_zh", "character_en", "origin", "prompt", "character_json")
    FUNCTION = "run"
    CATEGORY = "SAA/Character"
    OUTPUT_NODE = False

    def run(self, selected_character_id="", source_group="All", auto_refresh_data=False):
        STORE.ensure_loaded(force=False)
        data = STORE.get_character_output(selected_character_id)
        return (data["name_zh"], data["name_en"], data["origin"], data["prompt"], data["json"])


NODE_CLASS_MAPPINGS = {
    "SAACharacterSelector": SAACharacterSelector,
}

NODE_DISPLAY_NAME_MAPPINGS = {
    "SAACharacterSelector": "SAA Character Selector",
}
