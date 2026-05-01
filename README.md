# ComfyUI SAA Character Selector

ComfyUI custom node that:

1. Downloads Chinese/English character list and matching character thumbs from SAA sources.
2. Shows image cards in-node, supports click selection, and outputs selected character data.
3. Groups characters by origin.
4. Adds search box for Chinese/English/origin text.
5. Shows loading progress while downloading/parsing data.

## Install

Copy this folder into your ComfyUI custom nodes directory:

`ComfyUI/custom_nodes/ComfyUI_SAA_Character_Selector`

Then restart ComfyUI.

## Node

- Display name: `SAA Character Selector`
- Category: `SAA/Character`
- Outputs:
  - `character_zh`
  - `character_en`
  - `origin`
  - `prompt`
  - `character_json`

- Inputs:
  - `selected_character_id`: selected item id from UI image cards
  - `source_group`: source/origin grouping dropdown
  - `auto_refresh_data`: kept for workflow compatibility; data refresh is controlled by the in-node `Reload` button

## Data Sources

- Character CSV:
  - `https://raw.githubusercontent.com/mirabarukaso/character_select_stand_alone_app/refs/heads/main/data/wai_characters.csv`
- Character thumbs:
  - `https://huggingface.co/datasets/flagrantia/character_select_stand_alone_app/resolve/main/wai_character_thumbs_v160.json?download=true`

Downloaded files are stored directly in the custom node folder:

- `ComfyUI_SAA_Character_Selector/wai_characters.csv`
- `ComfyUI_SAA_Character_Selector/wai_character_thumbs_v160.json`

The files are downloaded only when missing. Click `Reload` in the node UI to force a fresh download from the upstream sources.
