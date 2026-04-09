# Dimensions — Minecraft Bedrock Preview Addon

> Made by **FonnyFofo** for **WanMine**

A Bedrock scripting experiment using the new **Custom Dimension API** (available since Preview 26.20.x).  
Adds three fully scripted custom dimensions accessible from anywhere via a travel UI.

---

## Dimensions

| Name | Description |
|---|---|
| **Umbra Depths** | Warden-inspired underground realm. Sculk floor, deepslate ceiling, pillar forest, 4 ruin sites, and a central altar. Pre-built on world load. |
| **Aether Expanse** | Infinite floating islands generated chunk by chunk as you explore. Three island biomes: Meadow, Crystal, Bone. |
| **Terra Genesis** | Up to 8 player-configured worlds, each in its own dedicated dimension. Choose biome style, ground block, time of day, mountains, trees, and a seed. |

---

## Requirements

- **Minecraft Preview** — versione **26.x** o superiore (tested on 26.20.x)
- **Beta APIs** experimental toggle enabled (see below)
- **Custom Dimensions** experimental toggle enabled (see below)

### How to enable experimental features

1. Create or open a world in **Minecraft Preview**
2. Go to **World Settings → Experiments**
3. Enable:
   - ✅ **Beta APIs**
   - ✅ **Custom Dimensions** *(may appear as "Upcoming Creator Features" depending on your build)*
4. Confirm the warning and load the world

---

## Installation

1. Download the `.mcaddon` file (or clone this repo and zip the `BP/` folder as `.mcpack`)
2. Open it — Minecraft will import it automatically
3. Apply the behavior pack to your Preview world
4. Make sure the experimental toggles above are active

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

- Umbra Depths is built once on world load and cached — subsequent loads skip generation
- Aether islands generate live as players move, using a deterministic hash so shape is consistent per-seed
- Terra worlds persist across sessions via dynamic properties; each world occupies its own dimension slot (`terra:world_0` through `terra:world_7`)
- This addon uses **JavaScript** (not TypeScript) for direct compatibility without a build step

---

## License

© FonnyFofo / WanMine. All rights reserved.  
Do not redistribute, reupload, or modify without explicit permission.
