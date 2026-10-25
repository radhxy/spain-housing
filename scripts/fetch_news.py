"""Pull the latest Spanish housing headlines from Google News RSS into data/news.json.

Each item is tagged with a topic (policy, election, rent, prices, tourism) by
keyword so the dashboard can filter the feed.
"""
import json
import os
import re
import urllib.parse
import urllib.request
from datetime import datetime, timezone
from email.utils import parsedate_to_datetime
from xml.etree import ElementTree

OUT = os.path.join(os.path.dirname(__file__), "..", "data", "news.json")
QUERIES = [
    ("es", "vivienda alquiler decreto OR ley when:14d"),
    ("es", "precio vivienda España when:14d"),
    ("es", "vivienda elecciones 29N when:14d"),
    ("en", "Spain housing rent when:14d"),
]
TOPICS = [
    ("election", r"elecci|electi|29n|campa|feij|s[aá]nchez|vox|sumar|pp\b|psoe|poll|encuesta"),
    ("policy", r"decreto|decree|ley\b|law|convalid|diputaci|tope|cap\b|boe|desahu|evict|okupa|squat"),
    ("tourism", r"tur[ií]stic|holiday|airbnb|temporada|seasonal"),
    ("rent", r"alquiler|rent|inquilin|tenant|arrend"),
    ("prices", r"precio|price|compraventa|sales|hipotec|mortgage|euribor|tasaci"),
]
MAX_ITEMS = 60


def feed(lang, q):
    params = {"q": q, "hl": "es" if lang == "es" else "en-GB",
              "gl": "ES", "ceid": "ES:es" if lang == "es" else "ES:en"}
    url = "https://news.google.com/rss/search?" + urllib.parse.urlencode(params)
    req = urllib.request.Request(url, headers={"User-Agent": "spain-housing-dashboard/1.0"})
    with urllib.request.urlopen(req, timeout=60) as r:
        root = ElementTree.fromstring(r.read())
    for it in root.iter("item"):
        title = it.findtext("title") or ""
        src = it.find("source")
        outlet = src.text if src is not None else ""
        if outlet and title.endswith(" - " + outlet):
            title = title[: -len(outlet) - 3]
        try:
            when = parsedate_to_datetime(it.findtext("pubDate")).astimezone(timezone.utc)
        except (TypeError, ValueError):
            continue
        low = title.lower()
        topic = next((t for t, rx in TOPICS if re.search(rx, low)), "other")
        yield {"title": title, "url": it.findtext("link"), "outlet": outlet, "lang": lang,
               "date": when.strftime("%Y-%m-%dT%H:%MZ"), "topic": topic}


def main():
    items, seen = [], set()
    for lang, q in QUERIES:
        try:
            for item in feed(lang, q):
                key = re.sub(r"\W+", "", item["title"].lower())[:80]
                if key not in seen:
                    seen.add(key)
                    items.append(item)
        except Exception as e:  # one failing query shouldn't drop the rest
            print(f"news query failed ({q}): {e}")
    items.sort(key=lambda i: i["date"], reverse=True)
    if not items:
        print("no news fetched; keeping previous file")
        return
    with open(OUT, "w", encoding="utf-8") as fh:
        json.dump({"fetched": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%MZ"),
                   "items": items[:MAX_ITEMS]}, fh, ensure_ascii=False, indent=1)
    print(f"wrote {min(len(items), MAX_ITEMS)} headlines")


if __name__ == "__main__":
    main()
