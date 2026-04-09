# Dimensions — Minecraft Bedrock Preview Addon

> Made by **FonnyFofo** for **WanMine**

Testing custom dimensions, scripted cinematics, procedural generation and world manipulation in Minecraft Bedrock Preview — building a multi-dimension travel system from scratch.

---

## Dimensions

| Name | Description |
|---|---|
| **Umbra Depths** | Warden-inspired underground realm. Sculk floor, deepslate ceiling, pillar forest, 4 ruin sites, and a central altar. Pre-built on world load. |
| **Aether Expanse** | Infinite floating islands generated chunk by chunk as you explore. Three island biomes: Meadow, Crystal, Bone. |
| **Terra Genesis** | Up to 8 player-configured worlds, each in its own dedicated dimension. Choose biome, ground block, mountain height, tree density, water level, caves, ores, and more. |

---

## Requirements

- **Minecraft Preview** — version 26.x or higher (tested on 26.20.x)
- The following **experimental toggles** must be enabled in world settings:
  - ✅ Beta APIs
  - ✅ Upcoming Creator Features
  - ✅ Custom Dimensions *(if listed separately)*

---

## Installation

1. Open your world in **Minecraft Preview**
2. Go to **World Settings → Add-Ons → Behavior Packs**
3. Create a behavior pack folder and place `main.js` inside a `scripts/` subfolder, with `manifest.json` at the root
4. Enable the pack and make sure the experimental toggles above are active
5. Load the world — use `/travel:portal` to open the travel menu

---

## Commands

| Command | Permission | Description |
|---|---|---|
| `/travel:portal` | Any player | Open the dimension travel menu |
| `/travel:reset_umbra` | GameDirectors | Rebuild Umbra Depths from scratch |
| `/travel:reset_aether` | GameDirectors | Clear Aether generation cache |
| `/travel:reset_terra` | GameDirectors | Wipe all Terra worlds |

---

## Notes

- **This is experimental.** The Custom Dimension API is a beta feature — things may break between Preview versions and generation is not optimized for large-scale use.
- This is a personal testing project, not a polished release. Expect rough edges.
- Umbra Depths is built once on world load and cached — rebuilding requires `/travel:reset_umbra`
- Aether islands generate live as you explore using deterministic noise, so shape is consistent per-seed
- Terra worlds persist across sessions via dynamic properties; each occupies its own dimension slot (`terra:world_0` through `terra:world_7`)
- Red/wrong fog in custom dimensions can be a issue i have planned to fix.

---

## License

© FonnyFofo / WanMine. All rights reserved.  
Do not redistribute, reupload, or modify without explicit permission.
