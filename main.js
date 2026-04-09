// =============================================================================
// Dimensions Addon — made by FonnyFofo for WanMine
// Unauthorized redistribution or modification without permission is prohibited.
// © FonnyFofo / WanMine. All rights reserved.
// =============================================================================
//
// THREE CUSTOM DIMENSIONS
//
//  1. umbra:depths   – Warden-inspired underground realm (finite, pre-built)
//  2. aether:expanse – Infinite floating islands, generated chunk by chunk
//  3. terra:genesis  – Player-configured world: mountains, lakes, trees, deserts
//                      Settings chosen via ModalFormData before teleporting
//
// Commands:
//   /travel:portal       – Open the travel UI (any player)
//   /travel:reset_umbra  – Rebuild Umbra Depths (GameDirectors)
//   /travel:reset_aether – Clear Aether generation cache (GameDirectors)
//   /travel:reset_terra  – Clear Terra Genesis and re-prompt settings (GameDirectors)
// =============================================================================

import {
  world,
  system,
  Player,
  BlockPermutation,
  CustomCommandStatus,
  CommandPermissionLevel,
} from "@minecraft/server";
import { ActionFormData, ModalFormData } from "@minecraft/server-ui";

// =============================================================================
// SECTION 1 – SHARED UTILITIES
// =============================================================================

// Terra Genesis slot count — defined here so startup registration can use it
const TERRA_MAX_WORLDS = 8;
function terraSlotDimId(index) { return `terra:world_${index}`; }

// Deterministic integer hash for two integers + a seed.
// Avoids Math.random() so world generation is stable across reloads.
function hash(x, z, seed) {
  let h = (x * 374761393 + z * 1376312589 + seed * 981237) | 0;
  h = Math.imul(h ^ (h >>> 13), 1540483477);
  h = h ^ (h >>> 15);
  return Math.abs(h);
}

// Convert a world X or Z coordinate to its chunk index (chunk = 16 blocks).
function toChunk(worldCoord) {
  return Math.floor(worldCoord / 16);
}

// Canonical string key for a chunk coordinate pair.
function chunkKey(cx, cz) {
  return `${cx},${cz}`;
}

// =============================================================================
// SECTION 2 – STARTUP: REGISTER DIMENSIONS + COMMANDS
// =============================================================================

system.beforeEvents.startup.subscribe((event) => {
  // Register custom dimensions
  event.dimensionRegistry.registerCustomDimension(UMBRA_ID);
  event.dimensionRegistry.registerCustomDimension(AETHER_ID);
  for (let i = 0; i < TERRA_MAX_WORLDS; i++) {
    event.dimensionRegistry.registerCustomDimension(terraSlotDimId(i));
  }

  // Shared travel command
  event.customCommandRegistry.registerCommand(
    {
      name: "travel:portal",
      description: "Open the dimension travel menu",
      permissionLevel: CommandPermissionLevel.Any,
      cheatsRequired: false,
    },
    (origin) => {
      const player = origin.sourceEntity;
      if (!(player instanceof Player)) {
        return { status: CustomCommandStatus.Failure, message: "Players only." };
      }
      system.run(() => showTravelMenu(player));
      return { status: CustomCommandStatus.Success };
    }
  );

  // Umbra admin command
  event.customCommandRegistry.registerCommand(
    {
      name: "travel:reset_umbra",
      description: "Rebuild the Umbra Depths dimension",
      permissionLevel: CommandPermissionLevel.GameDirectors,
      cheatsRequired: false,
    },
    () => {
      umbraBuilt = false;
      system.run(() => { void buildUmbraDepths(); });
      return { status: CustomCommandStatus.Success, message: "Rebuilding Umbra Depths..." };
    }
  );

  // Aether admin command
  event.customCommandRegistry.registerCommand(
    {
      name: "travel:reset_aether",
      description: "Clear Aether generation cache (new areas will regenerate)",
      permissionLevel: CommandPermissionLevel.GameDirectors,
      cheatsRequired: false,
    },
    () => {
      aetherGeneratedChunks.clear();
      return { status: CustomCommandStatus.Success, message: "Aether cache cleared." };
    }
  );

  // Terra admin command
  event.customCommandRegistry.registerCommand(
    {
      name: "travel:reset_terra",
      description: "Wipe Terra Genesis and re-prompt settings on next visit",
      permissionLevel: CommandPermissionLevel.GameDirectors,
      cheatsRequired: false,
    },
    () => {
      for (let i = 0; i < TERRA_MAX_WORLDS; i++) {
        terraSlotState[i].generatedChunks.clear();
        terraSlotState[i].queue.length = 0;
        terraSlotState[i].jobRunning = false;
      }
      terraSaveSlots([]);
      return { status: CustomCommandStatus.Success, message: "All Terra worlds deleted." };
    }
  );
});

// =============================================================================
// SECTION 3 – WORLD LOAD
// =============================================================================

world.afterEvents.worldLoad.subscribe(() => {
  system.run(() => { void buildUmbraDepths(); });
  startAetherGenerationLoop();
  startTerraGenerationLoop();

  world.sendMessage(
    "\u00A78[\u00A7rDimensions\u00A78]\u00A7r " +
    "Use \u00A7e/travel:portal\u00A7r to travel between dimensions."
  );
});

// =============================================================================
// SECTION 4 – UMBRA DEPTHS (warden-inspired, finite pre-built world)
// =============================================================================

const UMBRA_ID = "umbra:depths";
const UMBRA_SPAWN = { x: 0, y: 64, z: 0 };
const UMBRA_R = 48;
const FLOOR_Y = 60;
const CEILING_Y = 80;

let umbraBuilt = false;

async function buildUmbraDepths() {
  if (umbraBuilt) return;

  const dim = world.getDimension(UMBRA_ID);
  const r = UMBRA_R;
  const margin = 4;

  await world.tickingAreaManager.createTickingArea("umbra_build", {
    dimension: dim,
    from: { x: -r - margin, y: FLOOR_Y - 4, z: -r - margin },
    to: { x: r + margin, y: CEILING_Y + 4, z: r + margin },
  });

  umbraFloor(dim);
  umbraCeiling(dim);
  umbraPillars(dim);
  umbraRuins(dim);
  umbraAltar(dim);

  world.tickingAreaManager.removeTickingArea("umbra_build");
  umbraBuilt = true;
}

// Umbra: sculk floor
function umbraFloor(dim) {
  const sculk = BlockPermutation.resolve("minecraft:sculk");
  const deepslate = BlockPermutation.resolve("minecraft:deepslate");
  const sculkVein = BlockPermutation.resolve("minecraft:sculk_vein");
  const catalyst = BlockPermutation.resolve("minecraft:sculk_catalyst");
  const rDeep = BlockPermutation.resolve("minecraft:reinforced_deepslate");
  const obsidian = BlockPermutation.resolve("minecraft:obsidian");
  const r = UMBRA_R;

  for (let x = -r; x <= r; x++) {
    for (let z = -r; z <= r; z++) {
      if (x * x + z * z > r * r) continue;

      dim.getBlock({ x, y: FLOOR_Y - 2, z })?.setPermutation(obsidian);
      dim.getBlock({ x, y: FLOOR_Y - 1, z })?.setPermutation(deepslate);
      dim.getBlock({ x, y: FLOOR_Y, z })?.setPermutation(sculk);

      if (hash(x, z, 0) % 5 === 0)
        dim.getBlock({ x, y: FLOOR_Y + 1, z })?.setPermutation(sculkVein);
      if (hash(x, z, 1) % 40 === 0)
        dim.getBlock({ x, y: FLOOR_Y + 1, z })?.setPermutation(catalyst);
      if (hash(x, z, 2) % 18 === 0) {
        const h = 1 + (hash(x, z, 3) % 3);
        for (let y = 1; y <= h; y++)
          dim.getBlock({ x, y: FLOOR_Y + y, z })?.setPermutation(rDeep);
      }
    }
  }
}

// Umbra: deepslate ceiling with sculk sensor/shrieker draping
function umbraCeiling(dim) {
  const deepslate = BlockPermutation.resolve("minecraft:deepslate");
  const obsidian = BlockPermutation.resolve("minecraft:obsidian");
  const sculkVein = BlockPermutation.resolve("minecraft:sculk_vein");
  const shriek = BlockPermutation.resolve("minecraft:sculk_shrieker");
  const sensor = BlockPermutation.resolve("minecraft:sculk_sensor");
  const r = UMBRA_R;

  for (let x = -r; x <= r; x++) {
    for (let z = -r; z <= r; z++) {
      if (x * x + z * z > r * r) continue;

      dim.getBlock({ x, y: CEILING_Y, z })?.setPermutation(deepslate);
      dim.getBlock({ x, y: CEILING_Y + 1, z })?.setPermutation(obsidian);

      if (hash(x, z, 4) % 4 === 0)
        dim.getBlock({ x, y: CEILING_Y - 1, z })?.setPermutation(sculkVein);
      if (hash(x, z, 5) % 35 === 0)
        dim.getBlock({ x, y: CEILING_Y - 1, z })?.setPermutation(shriek);
      if (hash(x, z, 6) % 28 === 0)
        dim.getBlock({ x, y: CEILING_Y - 1, z })?.setPermutation(sensor);
    }
  }
}

// Umbra: pillar forest (scattered deepslate columns, floor-to-ceiling)
function umbraPillars(dim) {
  const deepslate = BlockPermutation.resolve("minecraft:deepslate");
  const deepBricks = BlockPermutation.resolve("minecraft:deepslate_bricks");
  const crying = BlockPermutation.resolve("minecraft:crying_obsidian");
  const shriek = BlockPermutation.resolve("minecraft:sculk_shrieker");
  const r = UMBRA_R;

  for (let gx = -r; gx <= r; gx += 8) {
    for (let gz = -r; gz <= r; gz += 8) {
      if (Math.abs(gx) < 16 && Math.abs(gz) < 16) continue;

      const jx = gx + (hash(gx, gz, 10) % 5) - 2;
      const jz = gz + (hash(gx, gz, 11) % 5) - 2;
      if (jx * jx + jz * jz > r * r) continue;

      const tall = hash(gx, gz, 12) % 3 !== 0;
      const topY = tall ? CEILING_Y : FLOOR_Y + 4 + (hash(gx, gz, 13) % 6);
      const midY = FLOOR_Y + Math.floor((topY - FLOOR_Y) / 2);

      for (let y = FLOOR_Y + 1; y <= topY; y++) {
        const perm = y % 3 === 0 ? deepBricks : deepslate;
        dim.getBlock({ x: jx, y, z: jz })?.setPermutation(perm);
      }
      dim.getBlock({ x: jx, y: midY, z: jz })?.setPermutation(crying);
      if (tall)
        dim.getBlock({ x: jx, y: CEILING_Y - 1, z: jz })?.setPermutation(shriek);
    }
  }
}

// Umbra: 4 ancient ruin sites (one per quadrant)
function umbraRuins(dim) {
  const sites = [
    { cx: 28, cz: 28 },
    { cx: -28, cz: 28 },
    { cx: 28, cz: -28 },
    { cx: -28, cz: -28 },
  ];
  for (const s of sites) umbraRuinSite(dim, s.cx, s.cz);
}

function umbraRuinSite(dim, cx, cz) {
  const tile = BlockPermutation.resolve("minecraft:deepslate_tiles");
  const bricks = BlockPermutation.resolve("minecraft:deepslate_bricks");
  const chiseled = BlockPermutation.resolve("minecraft:chiseled_deepslate");
  const cracked = BlockPermutation.resolve("minecraft:cracked_deepslate_tiles");
  const obsidian = BlockPermutation.resolve("minecraft:obsidian");

  for (let x = -3; x <= 3; x++)
    for (let z = -3; z <= 3; z++)
      dim.getBlock({ x: cx + x, y: FLOOR_Y + 1, z: cz + z })
        ?.setPermutation((x + z) % 2 === 0 ? tile : cracked);

  for (let x = -2; x <= 2; x++) {
    const wallH = 2 + (hash(cx + x, cz, 20) % 3);
    for (let y = 2; y <= wallH; y++)
      dim.getBlock({ x: cx + x, y: FLOOR_Y + y, z: cz - 3 })
        ?.setPermutation(y === wallH ? chiseled : bricks);
  }

  for (let y = 2; y <= 5; y++) {
    dim.getBlock({ x: cx + 3, y: FLOOR_Y + y, z: cz - 1 })?.setPermutation(bricks);
    dim.getBlock({ x: cx + 3, y: FLOOR_Y + y, z: cz + 1 })?.setPermutation(bricks);
  }
  dim.getBlock({ x: cx + 3, y: FLOOR_Y + 5, z: cz })?.setPermutation(chiseled);
  dim.getBlock({ x: cx + 3, y: FLOOR_Y + 1, z: cz + 3 })?.setPermutation(obsidian);
  dim.getBlock({ x: cx - 3, y: FLOOR_Y + 1, z: cz - 3 })?.setPermutation(obsidian);
}

// Umbra: central reinforced deepslate altar
function umbraAltar(dim) {
  const rDeep = BlockPermutation.resolve("minecraft:reinforced_deepslate");
  const chiseled = BlockPermutation.resolve("minecraft:chiseled_deepslate");
  const catalyst = BlockPermutation.resolve("minecraft:sculk_catalyst");
  const crying = BlockPermutation.resolve("minecraft:crying_obsidian");
  const shriek = BlockPermutation.resolve("minecraft:sculk_shrieker");
  const sculk = BlockPermutation.resolve("minecraft:sculk");

  for (let x = -8; x <= 8; x++)
    for (let z = -8; z <= 8; z++)
      if (x * x + z * z <= 64)
        dim.getBlock({ x, y: FLOOR_Y + 1, z })?.setPermutation(sculk);

  const tiers = [
    { r: 4, y: 1 }, { r: 3, y: 2 }, { r: 2, y: 3 }, { r: 1, y: 4 },
  ];
  for (const tier of tiers)
    for (let x = -tier.r; x <= tier.r; x++)
      for (let z = -tier.r; z <= tier.r; z++) {
        const perm = (Math.abs(x) === tier.r || Math.abs(z) === tier.r) ? chiseled : rDeep;
        dim.getBlock({ x, y: FLOOR_Y + tier.y, z })?.setPermutation(perm);
      }

  dim.getBlock({ x: 0, y: FLOOR_Y + 5, z: 0 })?.setPermutation(catalyst);

  for (let i = 0; i < 8; i++) {
    const angle = (i / 8) * Math.PI * 2;
    const px = Math.round(Math.cos(angle) * 6);
    const pz = Math.round(Math.sin(angle) * 6);
    for (let y = 1; y <= 4; y++)
      dim.getBlock({ x: px, y: FLOOR_Y + y, z: pz })?.setPermutation(crying);
    dim.getBlock({ x: px, y: FLOOR_Y + 5, z: pz })?.setPermutation(shriek);
  }
}

// =============================================================================
// SECTION 5 – AETHER EXPANSE (infinite procedural floating islands)
// =============================================================================

const AETHER_ID = "aether:expanse";
const AETHER_SPAWN = { x: 0, y: 80, z: 0 };
const AETHER_GEN_RADIUS = 3;
const AETHER_BASE_Y = 70;
const AETHER_TOP_Y = 90;
const AETHER_FLOOR_Y = 64;

const aetherGeneratedChunks = new Set();
const aetherQueue = [];
let aetherJobRunning = false;

// Generation loop: poll player positions every 40 ticks (2 s)
function startAetherGenerationLoop() {
  system.runInterval(() => {
    for (const player of world.getAllPlayers()) {
      if (player.dimension.id !== AETHER_ID) continue;

      const pcx = toChunk(player.location.x);
      const pcz = toChunk(player.location.z);

      for (let dx = -AETHER_GEN_RADIUS; dx <= AETHER_GEN_RADIUS; dx++) {
        for (let dz = -AETHER_GEN_RADIUS; dz <= AETHER_GEN_RADIUS; dz++) {
          const cx = pcx + dx;
          const cz = pcz + dz;
          const key = chunkKey(cx, cz);

          if (!aetherGeneratedChunks.has(key)) {
            aetherGeneratedChunks.add(key);
            aetherQueue.push({ cx, cz });
          }
        }
      }

      if (!aetherJobRunning && aetherQueue.length > 0) {
        aetherJobRunning = true;
        void processAetherQueue();
      }
    }
  }, 40);
}

async function processAetherQueue() {
  while (aetherQueue.length > 0) {
    const { cx, cz } = aetherQueue.shift();
    await runAetherChunk(cx, cz);
  }
  aetherJobRunning = false;
}

async function runAetherChunk(cx, cz) {
  const dim = world.getDimension(AETHER_ID);
  const originX = cx * 16;
  const originZ = cz * 16;
  const areaId = `aether_${cx}_${cz}`;

  await world.tickingAreaManager.createTickingArea(areaId, {
    dimension: dim,
    from: { x: originX, y: AETHER_FLOOR_Y - 1, z: originZ },
    to: { x: originX + 15, y: AETHER_TOP_Y + 4, z: originZ + 15 },
  });

  await new Promise((resolve) => {
    system.runJob(generateAetherChunkBlocks(dim, cx, cz, areaId, resolve));
  });
}

// Pure generator — no async/await allowed inside function*
function* generateAetherChunkBlocks(dim, cx, cz, areaId, onDone) {
  const originX = cx * 16;
  const originZ = cz * 16;

  // Void floor: safety net far below the islands
  const bedrock = BlockPermutation.resolve("minecraft:bedrock");
  for (let lx = 0; lx < 16; lx++) {
    for (let lz = 0; lz < 16; lz++) {
      dim.getBlock({ x: originX + lx, y: AETHER_FLOOR_Y, z: originZ + lz })
        ?.setPermutation(bedrock);
    }
    yield;
  }

  // Island clustering: ~50% of chunks get an island
  const clusterSeed = hash(Math.floor(cx / 3), Math.floor(cz / 3), 99);
  const hasIsland = hash(cx, cz, 100) % 2 === 0 || clusterSeed % 3 !== 0;
  if (!hasIsland) {
    world.tickingAreaManager.removeTickingArea(areaId);
    onDone();
    return;
  }

  // Island parameters
  const icx = originX + 8 + ((hash(cx, cz, 101) % 9) - 4);
  const icz = originZ + 8 + ((hash(cx, cz, 102) % 9) - 4);
  const radius = 7 + (hash(cx, cz, 103) % 5);
  const peakH = 3 + (hash(cx, cz, 104) % 5);
  const baseY = AETHER_BASE_Y + (hash(cx, cz, 105) % 6);
  const biome = hash(cx, cz, 200) % 3;   // 0=meadow  1=crystal  2=bone

  // Per-block dome shape
  for (let lx = 0; lx < 16; lx++) {
    for (let lz = 0; lz < 16; lz++) {
      const wx = originX + lx;
      const wz = originZ + lz;
      const dx = wx - icx;
      const dz = wz - icz;
      const dist = Math.sqrt(dx * dx + dz * dz);

      if (dist > radius) continue;

      const t = dist / radius;
      const domeFactor = Math.cos(t * Math.PI / 2);
      const surfaceH = Math.round(domeFactor * peakH);
      const surfaceY = baseY + surfaceH;
      const bodyDepth = 3 + Math.round(domeFactor * 5);

      placeIslandColumn(dim, wx, wz, surfaceY, bodyDepth, biome);
    }
    yield;
  }

  // Sparse accent feature at the island peak
  if (hash(cx, cz, 400) % 3 === 0) {
    const peakX = Math.round(icx);
    const peakZ = Math.round(icz);
    const peakY = baseY + peakH + 1;
    placeIslandAccent(dim, peakX, peakY, peakZ, biome);
  }

  // Secondary small island floating 8-14 blocks above (20% chance)
  if (hash(cx, cz, 500) % 5 === 0) {
    yield* generateFloatingIslet(dim, cx, cz, icx, icz, baseY + peakH + 10, biome);
  }

  world.tickingAreaManager.removeTickingArea(areaId);
  onDone();
}

// biome 0: meadow  – grass, dirt, stone
// biome 1: crystal – amethyst, calcite, deepslate
// biome 2: bone    – end stone, white concrete, obsidian
function placeIslandColumn(dim, x, z, surfaceY, depth, biome) {
  const BIOMES = [
    [
      BlockPermutation.resolve("minecraft:grass_block"),
      BlockPermutation.resolve("minecraft:dirt"),
      BlockPermutation.resolve("minecraft:stone"),
    ],
    [
      BlockPermutation.resolve("minecraft:amethyst_block"),
      BlockPermutation.resolve("minecraft:calcite"),
      BlockPermutation.resolve("minecraft:deepslate"),
    ],
    [
      BlockPermutation.resolve("minecraft:end_stone"),
      BlockPermutation.resolve("minecraft:white_concrete"),
      BlockPermutation.resolve("minecraft:obsidian"),
    ],
  ];

  const [top, mid, base] = BIOMES[biome];

  dim.getBlock({ x, y: surfaceY, z })?.setPermutation(top);
  for (let d = 1; d <= depth; d++) {
    dim.getBlock({ x, y: surfaceY - d, z })?.setPermutation(d === depth ? base : mid);
  }
}

function placeIslandAccent(dim, x, y, z, biome) {
  if (biome === 0) {
    const log = BlockPermutation.resolve("minecraft:oak_log");
    const leaves = BlockPermutation.resolve("minecraft:oak_leaves");
    for (let ty = 0; ty <= 3; ty++)
      dim.getBlock({ x, y: y + ty, z })?.setPermutation(log);
    for (let lx = -2; lx <= 2; lx++)
      for (let lz = -2; lz <= 2; lz++)
        for (let ly = 2; ly <= 4; ly++)
          if (lx !== 0 || lz !== 0 || ly > 3)
            dim.getBlock({ x: x + lx, y: y + ly, z: z + lz })?.setPermutation(leaves);
  } else if (biome === 1) {
    const amethyst = BlockPermutation.resolve("minecraft:amethyst_block");
    const crying = BlockPermutation.resolve("minecraft:crying_obsidian");
    const offsets = [[0, 0], [1, 0], [0, 1], [-1, 0], [0, -1]];
    for (const [ox, oz] of offsets) {
      const h = 2 + (hash(x + ox, z + oz, 600) % 4);
      for (let sy = 0; sy < h; sy++) {
        const perm = sy === h - 1 ? crying : amethyst;
        dim.getBlock({ x: x + ox, y: y + sy, z: z + oz })?.setPermutation(perm);
      }
    }
  } else {
    const bone = BlockPermutation.resolve("minecraft:bone_block");
    const skull = BlockPermutation.resolve("minecraft:wither_skeleton_skull");
    for (let by = 0; by <= 3; by++)
      dim.getBlock({ x, y: y + by, z })?.setPermutation(bone);
    dim.getBlock({ x, y: y + 4, z })?.setPermutation(skull);
  }
}

function* generateFloatingIslet(dim, cx, cz, icx, icz, isletY, biome) {
  const isletR = 2 + (hash(cx, cz, 702) % 3);

  for (let dx = -isletR; dx <= isletR; dx++) {
    for (let dz = -isletR; dz <= isletR; dz++) {
      const dist = Math.sqrt(dx * dx + dz * dz);
      if (dist > isletR) continue;
      const t = dist / isletR;
      const domeH = Math.round(Math.cos(t * Math.PI / 2) * 2);
      placeIslandColumn(dim, icx + dx, icz + dz, isletY + domeH, 2, biome);
    }
    yield;
  }
}

// =============================================================================
// SECTION 5B – TERRA GENESIS (player-configured procedural worlds)
// =============================================================================
//
// Each saved world gets its own dedicated custom dimension: terra:world_0 to terra:world_7.
// TERRA_MAX_WORLDS slots are registered at startup so they always exist.
// Slot metadata (name, config) persists via world dynamic properties.
//
// Generation uses multi-octave value noise (smooth, no grid artifacts) with:
//   - Continental scale  (very low frequency)  → broad landmasses vs ocean
//   - Mountain scale     (low frequency)        → ridge placement
//   - Hill scale         (medium frequency)     → rolling hills
//   - Detail scale       (high frequency)       → surface roughness
//   - Cave noise         (3D)                   → hollow pockets underground
//   - River noise                               → narrow low-lying strips
//   - Biome blend noise                         → soft biome transitions
//
// Surface features: trees (oak/birch/spruce/jungle/dark oak), flowers, ferns,
//   tall grass, cactus, dead bushes, boulders, mushrooms, kelp in shallow water,
//   ice caps in arctic, lava pools in nether biome, coral in warm ocean.

const TERRA_SPAWN = { x: 0, y: 100, z: 0 };
const TERRA_SEA_Y = 63;
const TERRA_BEDROCK_Y = 0;
const TERRA_SLOTS_KEY = "terra_slots";

const terraSlotState = [];
for (let i = 0; i < TERRA_MAX_WORLDS; i++) {
  terraSlotState.push({ generatedChunks: new Set(), queue: [], jobRunning: false });
}

// =============================================================================
// NOISE ENGINE
// =============================================================================
// Multi-octave smooth value noise built on top of the integer hash function.
// smoothstep interpolation gives continuous, non-boxy terrain.

function smoothstep(t) {
  return t * t * (3 - 2 * t);
}

// Bilinear interpolation of four corner values
function bilerp(v00, v10, v01, v11, tx, ty) {
  const a = v00 + (v10 - v00) * tx;
  const b = v01 + (v11 - v01) * tx;
  return a + (b - a) * ty;
}

// Single-octave smooth value noise, returns 0..1
function valueNoise2D(x, z, seed) {
  const xi = Math.floor(x);
  const zi = Math.floor(z);
  const tx = smoothstep(x - xi);
  const tz = smoothstep(z - zi);

  const v00 = (hash(xi, zi, seed) % 1024) / 1023;
  const v10 = (hash(xi + 1, zi, seed) % 1024) / 1023;
  const v01 = (hash(xi, zi + 1, seed) % 1024) / 1023;
  const v11 = (hash(xi + 1, zi + 1, seed) % 1024) / 1023;

  return bilerp(v00, v10, v01, v11, tx, tz);
}

// Multi-octave fractal noise — standard fBm with 4 octaves
// Returns 0..1
function fbm(x, z, seed, octaves = 4) {
  let value = 0;
  let amplitude = 0.5;
  let frequency = 1;
  let maxVal = 0;

  for (let i = 0; i < octaves; i++) {
    value += valueNoise2D(x * frequency, z * frequency, seed + i * 1337) * amplitude;
    maxVal += amplitude;
    amplitude *= 0.5;
    frequency *= 2.1;
  }

  return value / maxVal;
}

// 3D value noise for caves
function valueNoise3D(x, y, z, seed) {
  const xi = Math.floor(x);
  const yi = Math.floor(y);
  const zi = Math.floor(z);
  const tx = smoothstep(x - xi);
  const ty = smoothstep(y - yi);
  const tz = smoothstep(z - zi);

  // Sample 8 corners
  const c000 = (hash(xi, zi, seed + yi * 997) % 1024) / 1023;
  const c100 = (hash(xi + 1, zi, seed + yi * 997) % 1024) / 1023;
  const c010 = (hash(xi, zi + 1, seed + yi * 997) % 1024) / 1023;
  const c110 = (hash(xi + 1, zi + 1, seed + yi * 997) % 1024) / 1023;
  const c001 = (hash(xi, zi, seed + (yi + 1) * 997) % 1024) / 1023;
  const c101 = (hash(xi + 1, zi, seed + (yi + 1) * 997) % 1024) / 1023;
  const c011 = (hash(xi, zi + 1, seed + (yi + 1) * 997) % 1024) / 1023;
  const c111 = (hash(xi + 1, zi + 1, seed + (yi + 1) * 997) % 1024) / 1023;

  const b0 = bilerp(c000, c100, c010, c110, tx, tz);
  const b1 = bilerp(c001, c101, c011, c111, tx, tz);
  return b0 + (b1 - b0) * ty;
}

// =============================================================================
// TERRAIN HEIGHT FUNCTION
// =============================================================================

function terraSampleHeight(wx, wz, cfg) {
  const S = cfg.seed;
  const mtnS = cfg.mountainH / 10;   // 0.0 .. 1.0

  // Continental mask: large blobs of high/low land
  const continental = fbm(wx / 600, wz / 600, S + 0, 3);  // 0..1

  // Mountain ridge noise: warped high-frequency fbm
  const warpX = fbm(wx / 180, wz / 180, S + 100, 2) * 2 - 1;
  const warpZ = fbm(wx / 180, wz / 180, S + 200, 2) * 2 - 1;
  const ridge = fbm((wx + warpX * 40) / 100, (wz + warpZ * 40) / 100, S + 300, 4);

  // Rolling hills
  const hills = fbm(wx / 80, wz / 80, S + 400, 4);

  // Fine surface detail
  const detail = fbm(wx / 20, wz / 20, S + 500, 3);

  // Biome-driven extra roughness
  const biomeRoughness = cfg.biome === 2 ? 0.3 : cfg.biome === 0 ? 0.1 : 0.2;

  // Blend: continental sets the macro shape, ridge adds drama, hills + detail fill in
  const blended =
    continental * 0.35 +
    ridge * mtnS * 0.40 +
    hills * 0.15 +
    detail * biomeRoughness;

  // Map 0..1 → actual Y around sea level
  // Range: TERRA_SEA_Y - 18  to  TERRA_SEA_Y + 60 * mtnS + 20
  const seaFloor = TERRA_SEA_Y - 18;
  const maxHeight = TERRA_SEA_Y + Math.round(60 * mtnS) + 20;
  return Math.round(seaFloor + blended * (maxHeight - seaFloor));
}

// =============================================================================
// CAVE CARVER
// =============================================================================
// Returns true if a block at (wx, wy, wz) should be air (carved out).
// Uses two 3D noise channels combined — classic "cave worm" approach via noise.

function isCave(wx, wy, wz, S) {
  if (wy <= TERRA_BEDROCK_Y + 3) return false;

  const n1 = valueNoise3D(wx / 12, wy / 8, wz / 12, S + 700);
  const n2 = valueNoise3D(wx / 12, wy / 8, wz / 12, S + 800);

  // Cave when both channels near 0.5 (tube-like threshold)
  const v1 = Math.abs(n1 - 0.5);
  const v2 = Math.abs(n2 - 0.5);

  return (v1 < 0.07 && v2 < 0.07);
}

// =============================================================================
// BIOME CONFIGURATION
// =============================================================================

const TERRA_BIOMES = [
  // 0 – Desert
  {
    label: "Desert",
    subsurf: "minecraft:sandstone",
    deep: "minecraft:smooth_sandstone",
    liquid: "minecraft:lava",
    lakeFloor: "minecraft:magma",
    hasLava: true,
  },
  // 1 – Temperate Forest
  {
    label: "Forest",
    subsurf: "minecraft:stone",
    deep: "minecraft:deepslate",
    liquid: "minecraft:water",
    lakeFloor: "minecraft:gravel",
    hasLava: false,
  },
  // 2 – Arctic
  {
    label: "Arctic",
    subsurf: "minecraft:packed_ice",
    deep: "minecraft:deepslate",
    liquid: "minecraft:water",
    lakeFloor: "minecraft:gravel",
    hasLava: false,
  },
  // 3 – Mushroom / Mycelium
  {
    label: "Mycelium",
    subsurf: "minecraft:stone",
    deep: "minecraft:deepslate",
    liquid: "minecraft:water",
    lakeFloor: "minecraft:clay",
    hasLava: false,
  },
  // 4 – Nether-like
  {
    label: "Nether",
    subsurf: "minecraft:netherrack",
    deep: "minecraft:netherrack",
    liquid: "minecraft:lava",
    lakeFloor: "minecraft:magma",
    hasLava: true,
  },
  // 5 – Savanna
  {
    label: "Savanna",
    subsurf: "minecraft:stone",
    deep: "minecraft:deepslate",
    liquid: "minecraft:water",
    lakeFloor: "minecraft:sand",
    hasLava: false,
  },
];

const TERRA_BIOME_LABELS = TERRA_BIOMES.map((b) => b.label);

// =============================================================================
// GROUND BLOCK OPTIONS
// =============================================================================

const TERRA_GROUND_BLOCKS = [
  { label: "Auto (biome)", id: null },
  { label: "Grass", id: "minecraft:grass_block" },
  { label: "Sand", id: "minecraft:sand" },
  { label: "Red Sand", id: "minecraft:red_sand" },
  { label: "Snow", id: "minecraft:snow_block" },
  { label: "Mycelium", id: "minecraft:mycelium" },
  { label: "Soul Sand", id: "minecraft:soul_sand" },
  { label: "Mud", id: "minecraft:mud" },
  { label: "Tuff", id: "minecraft:tuff" },
  { label: "Crimson Nylium", id: "minecraft:crimson_nylium" },
  { label: "Warped Nylium", id: "minecraft:warped_nylium" },
  { label: "Podzol", id: "minecraft:podzol" },
];

// Default ground block per biome when "Auto" is selected
const BIOME_AUTO_GROUND = [
  "minecraft:sand",           // Desert
  "minecraft:grass_block",    // Forest
  "minecraft:snow_block",     // Arctic
  "minecraft:mycelium",       // Mushroom
  "minecraft:netherrack",     // Nether
  "minecraft:grass_block",    // Savanna
];

// =============================================================================
// TIME OPTIONS
// =============================================================================

const TERRA_TIMES = [
  { label: "Dawn", ticks: 23000 },
  { label: "Noon", ticks: 6000 },
  { label: "Dusk", ticks: 12000 },
  { label: "Night", ticks: 18000 },
];

// =============================================================================
// SLOT PERSISTENCE
// =============================================================================

function terraLoadSlots() {
  try {
    const raw = world.getDynamicProperty(TERRA_SLOTS_KEY);
    if (typeof raw === "string") return JSON.parse(raw);
  } catch { /* fall through */ }
  return [];
}

function terraSaveSlots(slots) {
  world.setDynamicProperty(TERRA_SLOTS_KEY, JSON.stringify(slots));
}

function terraNextFreeIndex() {
  const used = new Set(terraLoadSlots().map((s) => s.index));
  for (let i = 0; i < TERRA_MAX_WORLDS; i++) {
    if (!used.has(i)) return i;
  }
  return -1;
}

// =============================================================================
// SLOT SELECTION FORM
// =============================================================================

function showTerraSlotMenu(player) {
  return new Promise((resolve) => {
    const slots = terraLoadSlots();

    const form = new ActionFormData()
      .title("\u00A72\u00A7lTerra Genesis")
      .body(
        slots.length === 0
          ? "\u00A77No worlds yet. Create your first one!"
          : "\u00A77Pick a world to visit, or create a new one.\n\u00A78Max " + TERRA_MAX_WORLDS + " worlds."
      );

    for (const slot of slots) {
      const biome = TERRA_BIOMES[slot.config.biome]?.label ?? "?";
      const ground = TERRA_GROUND_BLOCKS.find((b) => b.id === slot.config.groundBlock)?.label
        ?? (slot.config.groundBlock === null ? "Auto" : "?");
      const time = TERRA_TIMES.find((t) => t.ticks === slot.config.timeOfDay)?.label ?? "?";
      form.button(
        "\u00A7f\u00A7l" + slot.name + "\u00A7r\n" +
        "\u00A78" + biome + " \u00B7 " + ground +
        " \u00B7 Mtn " + slot.config.mountainH +
        " \u00B7 " + time
      );
    }

    if (slots.length < TERRA_MAX_WORLDS) {
      form.button("\u00A7a\u00A7l+ New World\u00A7r\n\u00A78Configure and generate a new world");
    }

    form.show(player).then((response) => {
      if (response.canceled || response.selection === undefined) { resolve(undefined); return; }
      const selected = response.selection === slots.length ? null : slots[response.selection];
      if (selected === null) { resolve(null); return; }

      // Show enter/delete options
      new ActionFormData()
        .title("\u00A7f\u00A7l" + selected.name)
        .body("\u00A77What do you want to do with this world?")
        .button("\u00A7aEnter World")
        .button("\u00A7cDelete World")
        .show(player).then((r) => {
          if (r.canceled || r.selection === undefined) { resolve(undefined); return; }
          if (r.selection === 1) {
            // Delete: remove from slots, clear generation state
            const updated = terraLoadSlots().filter((s) => s.index !== selected.index);
            terraSaveSlots(updated);
            const state = terraSlotState[selected.index];
            state.generatedChunks.clear();
            state.queue.length = 0;
            state.jobRunning = false;
            player.sendMessage("\u00A7cWorld \u00A7f" + selected.name + "\u00A7c deleted.");
            resolve(undefined);
          } else {
            resolve(selected);
          }
        });
    });
  });
}

// =============================================================================
// NEW WORLD FORM
// =============================================================================

function showTerraNewWorldForm(player) {
  return new Promise((resolve) => {
    const form = new ModalFormData()
      .title("\u00A72\u00A7lTerra Genesis \u00A78\u2013 New World")
      .textField("\u00A77World name", "My World", { defaultValue: "My World" })
      .dropdown("\u00A77Biome", TERRA_BIOME_LABELS, { defaultValueIndex: 1 })
      .dropdown("\u00A77Ground block", TERRA_GROUND_BLOCKS.map((b) => b.label), { defaultValueIndex: 0 })
      .slider("\u00A77Mountain height", 0, 10, { valueStep: 1, defaultValue: 5 })
      .slider("\u00A77Tree density", 0, 10, { valueStep: 1, defaultValue: 5 })
      .slider("\u00A77Lake / ocean fill level (0 = no water)", 0, 10, { valueStep: 1, defaultValue: 5 })
      .toggle("\u00A77Caves", { defaultValue: true })
      .toggle("\u00A77Ores", { defaultValue: true })
      .toggle("\u00A77Boulders", { defaultValue: true })
      .dropdown("\u00A77Time of day", TERRA_TIMES.map((t) => t.label), { defaultValueIndex: 1 })
      .slider("\u00A77Seed (0 = random)", 0, 9999, { valueStep: 1, defaultValue: 0 });

    form.show(player).then((response) => {
      if (response.canceled || !response.formValues) { resolve(null); return; }

      const [rawName, biomeIdx, groundIdx, mountainH, treeDensity, waterLevel,
        caves, ores, boulders, timeIdx, seedRaw] = response.formValues;

      const name = (typeof rawName === "string" && rawName.trim())
        ? rawName.trim()
        : "World " + (terraLoadSlots().length + 1);

      const groundEntry = TERRA_GROUND_BLOCKS[groundIdx];
      const groundBlock = (groundEntry && groundEntry.id !== null)
        ? groundEntry.id
        : BIOME_AUTO_GROUND[biomeIdx] ?? "minecraft:grass_block";

      const seed = Number(seedRaw) !== 0
        ? Number(seedRaw)
        : Math.abs((Date.now() ^ (Math.random() * 0xFFFFFFFF | 0)) | 0);

      resolve({
        name,
        config: {
          biome: biomeIdx,
          groundBlock,
          mountainH: Number(mountainH),
          treeDensity: Number(treeDensity),
          waterLevel: Number(waterLevel),
          caves: Boolean(caves),
          ores: Boolean(ores),
          boulders: Boolean(boulders),
          timeOfDay: TERRA_TIMES[timeIdx].ticks,
          seed,
        },
      });
    });
  });
}

// =============================================================================
// GENERATION LOOP
// =============================================================================

function startTerraGenerationLoop() {
  system.runInterval(() => {
    for (const player of world.getAllPlayers()) {
      const dimId = player.dimension.id;
      if (!dimId.startsWith("terra:world_")) continue;

      const slotIndex = parseInt(dimId.replace("terra:world_", ""), 10);
      if (isNaN(slotIndex) || slotIndex >= TERRA_MAX_WORLDS) continue;

      const slots = terraLoadSlots();
      const slot = slots.find((s) => s.index === slotIndex);
      if (!slot) continue;

      const state = terraSlotState[slotIndex];
      const pcx = toChunk(player.location.x);
      const pcz = toChunk(player.location.z);

      for (let dx = -3; dx <= 3; dx++) {
        for (let dz = -3; dz <= 3; dz++) {
          const key = chunkKey(pcx + dx, pcz + dz);
          if (!state.generatedChunks.has(key)) {
            state.generatedChunks.add(key);
            state.queue.push({ cx: pcx + dx, cz: pcz + dz });
          }
        }
      }

      if (!state.jobRunning && state.queue.length > 0) {
        // Sort by distance from player so nearest chunks generate first
        const px = player.location.x;
        const pz = player.location.z;
        state.queue.sort((a, b) => {
          const da = (a.cx * 16 - px) ** 2 + (a.cz * 16 - pz) ** 2;
          const db = (b.cx * 16 - px) ** 2 + (b.cz * 16 - pz) ** 2;
          return da - db;
        });
        state.jobRunning = true;
        void processTerraSlotQueue(slotIndex, slot.config);
      }
    }
  }, 40);
}

async function processTerraSlotQueue(slotIndex, config) {
  const state = terraSlotState[slotIndex];
  while (state.queue.length > 0) {
    const { cx, cz } = state.queue.shift();
    await runTerraChunk(slotIndex, config, cx, cz);
  }
  state.jobRunning = false;
}

async function runTerraChunk(slotIndex, config, cx, cz) {
  const dim = world.getDimension(terraSlotDimId(slotIndex));
  const originX = cx * 16;
  const originZ = cz * 16;
  const areaId = `terra_${slotIndex}_${cx}_${cz}`;

  await world.tickingAreaManager.createTickingArea(areaId, {
    dimension: dim,
    from: { x: originX, y: TERRA_BEDROCK_Y, z: originZ },
    to: { x: originX + 15, y: TERRA_SEA_Y + 60, z: originZ + 15 },
  });

  await new Promise((resolve) => {
    system.runJob(generateTerraChunk(dim, config, cx, cz, areaId, resolve));
  });
}

// =============================================================================
// CHUNK GENERATOR
// =============================================================================

function* generateTerraChunk(dim, cfg, cx, cz, areaId, onDone) {
  const originX = cx * 16;
  const originZ = cz * 16;
  const S = cfg.seed;
  const biomeData = TERRA_BIOMES[cfg.biome] ?? TERRA_BIOMES[1];

  // Pre-resolve block permutations
  const bedrockP = BlockPermutation.resolve("minecraft:bedrock");
  const groundP = BlockPermutation.resolve(cfg.groundBlock);
  const subsurfP = BlockPermutation.resolve(biomeData.subsurf);
  const deepP = BlockPermutation.resolve(biomeData.deep);
  const liquidP = BlockPermutation.resolve(biomeData.liquid);
  const lakeFlrP = BlockPermutation.resolve(biomeData.lakeFloor);
  const iceP = BlockPermutation.resolve("minecraft:ice");
  const dirtP = BlockPermutation.resolve("minecraft:dirt");
  const gravelP = BlockPermutation.resolve("minecraft:gravel");
  const sandP = BlockPermutation.resolve("minecraft:sand");

  // Effective sea level based on waterLevel slider (0 = no liquid, 10 = flooded)
  // waterLevel 5 = sea at TERRA_SEA_Y, 0 = nothing, 10 = +10 blocks
  const effectiveSeaY = cfg.waterLevel === 0
    ? -999
    : TERRA_SEA_Y - 5 + Math.round(cfg.waterLevel);

  // ── Pass 1: bedrock ─────────────────────────────────────────────────────────
  for (let lx = 0; lx < 16; lx++) {
    for (let lz = 0; lz < 16; lz++) {
      dim.getBlock({ x: originX + lx, y: TERRA_BEDROCK_Y, z: originZ + lz })?.setPermutation(bedrockP);
      dim.getBlock({ x: originX + lx, y: TERRA_BEDROCK_Y + 1, z: originZ + lz })?.setPermutation(bedrockP);
      if (hash(originX + lx, originZ + lz, S + 9000) % 3 !== 0)
        dim.getBlock({ x: originX + lx, y: TERRA_BEDROCK_Y + 2, z: originZ + lz })?.setPermutation(bedrockP);
    }
    yield;
  }

  // ── Pass 2: solid terrain column ────────────────────────────────────────────
  for (let lx = 0; lx < 16; lx++) {
    for (let lz = 0; lz < 16; lz++) {
      const wx = originX + lx;
      const wz = originZ + lz;

      const surfY = terraSampleHeight(wx, wz, cfg);

      for (let y = TERRA_BEDROCK_Y + 3; y <= surfY; y++) {
        // Cave carver
        if (cfg.caves && y > TERRA_BEDROCK_Y + 5 && y < surfY - 1 && isCave(wx, y, wz, S))
          continue;

        let perm;
        if (y === surfY) {
          perm = groundP;
        } else if (y >= surfY - 3) {
          // Dirt/subsurf transition below surface
          perm = (cfg.biome === 0 || cfg.biome === 4) ? subsurfP : dirtP;
        } else if (y < TERRA_BEDROCK_Y + 20) {
          perm = deepP;
        } else {
          perm = subsurfP;
        }

        // Ore replacement (stone-like blocks only)
        if (cfg.ores && perm === subsurfP && y < surfY - 4) {
          perm = terraOreAt(wx, y, wz, S, cfg.biome) ?? perm;
        }

        dim.getBlock({ x: wx, y, z: wz })?.setPermutation(perm);
        if (cfg.biome === 4 && y > TERRA_BEDROCK_Y + 5 && y < surfY - 2
          && hash(wx, y * 13 + wz, S + 4500) % 150 === 0) {
          dim.getBlock({ x: wx, y, z: wz })?.setPermutation(liquidP);
        }
      }

      // ── Liquid fill below effective sea level ──────────────────────────────
      if (surfY < effectiveSeaY) {
        // Lake/ocean floor
        dim.getBlock({ x: wx, y: surfY, z: wz })?.setPermutation(lakeFlrP);

        for (let wy = surfY + 1; wy <= effectiveSeaY; wy++) {
          // Top layer of arctic ocean = ice
          const topLayer = cfg.biome === 2 && wy === effectiveSeaY;
          dim.getBlock({ x: wx, y: wy, z: wz })?.setPermutation(topLayer ? iceP : liquidP);
        }
      }

      // Gravel beaches at sea edge
      if (surfY >= effectiveSeaY && surfY <= effectiveSeaY + 2 && cfg.waterLevel > 0) {
        if (cfg.biome !== 0 && cfg.biome !== 4) {
          dim.getBlock({ x: wx, y: surfY, z: wz })?.setPermutation(gravelP);
        } else {
          dim.getBlock({ x: wx, y: surfY, z: wz })?.setPermutation(sandP);
        }
      }

      // Arctic: snow cap above a threshold
      if (cfg.biome === 2 && surfY > effectiveSeaY + 2 && surfY >= TERRA_SEA_Y + 15) {
        dim.getBlock({ x: wx, y: surfY + 1, z: wz })
          ?.setPermutation(BlockPermutation.resolve("minecraft:snow_layer"));
      }
    }
    yield;
  }

  // ── Pass 3: surface features ─────────────────────────────────────────────────
  for (let lx = 0; lx < 16; lx++) {
    for (let lz = 0; lz < 16; lz++) {
      const wx = originX + lx;
      const wz = originZ + lz;
      const surfY = terraSampleHeight(wx, wz, cfg);

      if (surfY >= effectiveSeaY + 1) {
        placeTerraFeature(dim, wx, surfY + 1, wz, cfg, S, effectiveSeaY);
      }

      // Boulder (biome-agnostic, scattered)
      if (cfg.boulders && hash(wx, wz, S + 6000) % 120 === 0 && surfY > effectiveSeaY + 2) {
        placeBoulder(dim, wx, surfY + 1, wz, biomeData.subsurf);
      }
    }
    yield;
  }

  world.tickingAreaManager.removeTickingArea(areaId);
  onDone();
}

// =============================================================================
// ORE PLACEMENT
// =============================================================================

function terraOreAt(x, y, z, S, biome) {
  const v = hash(x, y * 7 + z, S + 3000) % 200;

  if (biome === 0) {
    // Desert: gold abbondante, niente coal
    if (y < 30 && v < 15) return BlockPermutation.resolve("minecraft:gold_ore");
    if (y < 20 && v < 5) return BlockPermutation.resolve("minecraft:diamond_ore");
    if (y < 40 && v < 10) return BlockPermutation.resolve("minecraft:iron_ore");
    return null;
  }
  if (biome === 4) {
    // Nether: nether quartz e nether gold ovunque, lava pockets
    if (v < 20) return BlockPermutation.resolve("minecraft:quartz_ore");
    if (v < 30) return BlockPermutation.resolve("minecraft:nether_gold_ore");
    if (v < 33) return BlockPermutation.resolve("minecraft:ancient_debris");
    return null;
  }
  if (biome === 2) {
    // Arctic: più iron, niente gold
    if (y < 16 && v < 3) return BlockPermutation.resolve("minecraft:diamond_ore");
    if (y < 50 && v < 25) return BlockPermutation.resolve("minecraft:iron_ore");
    if (y < 40 && v < 10) return BlockPermutation.resolve("minecraft:coal_ore");
    return null;
  }

  // Default (Forest, Mycelium, Savanna)
  if (y < 16 && v < 3) return BlockPermutation.resolve("minecraft:diamond_ore");
  if (y < 30 && v < 8) return BlockPermutation.resolve("minecraft:gold_ore");
  if (y < 50 && v < 18) return BlockPermutation.resolve("minecraft:iron_ore");
  if (y < 70 && v < 28) return BlockPermutation.resolve("minecraft:coal_ore");
  if (y < 32 && v < 12) return BlockPermutation.resolve("minecraft:redstone_ore");
  if (y < 40 && v < 10) return BlockPermutation.resolve("minecraft:lapis_ore");
  return null;
}

// =============================================================================
// BOULDER
// =============================================================================

function placeBoulder(dim, x, y, z, subsurf) {
  const perm = BlockPermutation.resolve(subsurf);
  const r = 1 + (hash(x, z, 5555) % 2);   // radius 1 or 2
  for (let dx = -r; dx <= r; dx++)
    for (let dy = 0; dy <= r; dy++)
      for (let dz = -r; dz <= r; dz++)
        if (dx * dx + dy * dy + dz * dz <= r * r + 1)
          dim.getBlock({ x: x + dx, y: y + dy, z: z + dz })?.setPermutation(perm);
}

// =============================================================================
// SURFACE FEATURES
// =============================================================================

function placeTerraFeature(dim, x, y, z, cfg, S, effectiveSeaY) {
  const biome = cfg.biome;
  const density = cfg.treeDensity;           // 0..10
  const wantsTree = (hash(x, z, 700 + S) % 20) < density;
  const wantsFlora = (hash(x, z, 720 + S) % 10) < Math.max(density - 2, 1);

  if (biome === 0) {
    // ── Desert ──────────────────────────────────────────────────────────────
    if (wantsTree && hash(x, z, 701 + S) % 3 === 0) {
      const h = 2 + (hash(x, z, 702 + S) % 3);
      const cactus = BlockPermutation.resolve("minecraft:cactus");
      for (let cy = 0; cy < h; cy++)
        dim.getBlock({ x, y: y + cy, z })?.setPermutation(cactus);
    } else if (wantsFlora && hash(x, z, 703 + S) % 3 === 0) {
      dim.getBlock({ x, y, z })?.setPermutation(BlockPermutation.resolve("minecraft:deadbush"));
    }

  } else if (biome === 1) {
    // ── Temperate Forest ─────────────────────────────────────────────────────
    if (wantsTree) {
      const variant = hash(x, z, 704 + S) % 4;
      if (variant === 0) placeOakTree(dim, x, y, z, S);
      else if (variant === 1) placeBirchTree(dim, x, y, z, S);
      else if (variant === 2) placeSpruceTree(dim, x, y, z, S);
      else placeBigOakTree(dim, x, y, z, S);
    } else if (wantsFlora) {
      const r = hash(x, z, 710 + S) % 10;
      if (r < 3) dim.getBlock({ x, y, z })?.setPermutation(BlockPermutation.resolve("minecraft:fern"));
      else if (r < 5) {
        dim.getBlock({ x, y, z })?.setPermutation(BlockPermutation.resolve("minecraft:tall_grass"));
        dim.getBlock({ x, y, z })?.setPermutation(BlockPermutation.resolve("minecraft:tall_grass"));
      }
      else if (r < 7) {
        const flowers = ["minecraft:poppy", "minecraft:dandelion", "minecraft:cornflower",
          "minecraft:azure_bluet", "minecraft:oxeye_daisy", "minecraft:allium"];
        dim.getBlock({ x, y, z })?.setPermutation(
          BlockPermutation.resolve(flowers[hash(x, z, 711 + S) % flowers.length])
        );
      }
      else if (r < 9) {
        dim.getBlock({ x, y, z })?.setPermutation(BlockPermutation.resolve("minecraft:rose_bush"));
        dim.getBlock({ x, y, z })?.setPermutation(BlockPermutation.resolve("minecraft:rose_bush"));
      }
    }

    // Mushroom patch in dark spots (low density, random)
    if (hash(x, z, 715 + S) % 60 === 0) {
      const mush = hash(x, z, 716 + S) % 2 === 0 ? "minecraft:brown_mushroom" : "minecraft:red_mushroom";
      dim.getBlock({ x, y, z })?.setPermutation(BlockPermutation.resolve(mush));
    }

  } else if (biome === 2) {
    // ── Arctic ───────────────────────────────────────────────────────────────
    if (wantsTree && hash(x, z, 720 + S) % 3 === 0) {
      placeSpruceTree(dim, x, y, z, S);
    } else {
      // Dead bushes and occasional fern break the snow
      if (hash(x, z, 721 + S) % 25 === 0)
        dim.getBlock({ x, y, z })?.setPermutation(BlockPermutation.resolve("minecraft:deadbush"));
    }

  } else if (biome === 3) {
    // ── Mycelium ──────────────────────────────────────────────────────────────
    if (wantsTree) {
      const big = hash(x, z, 730 + S) % 3 === 0;
      if (big) {
        // Big brown mushroom
        const stem = BlockPermutation.resolve("minecraft:brown_mushroom_block");
        const cap = BlockPermutation.resolve("minecraft:brown_mushroom_block");
        const h = 5 + (hash(x, z, 731 + S) % 4);
        for (let sy = 0; sy < h; sy++)
          dim.getBlock({ x, y: y + sy, z })?.setPermutation(stem);
        for (let mx = -3; mx <= 3; mx++)
          for (let mz = -3; mz <= 3; mz++)
            if (mx * mx + mz * mz <= 10)
              dim.getBlock({ x: x + mx, y: y + h, z: z + mz })?.setPermutation(cap);
      } else {
        const mush = hash(x, z, 732 + S) % 2 === 0 ? "minecraft:brown_mushroom" : "minecraft:red_mushroom";
        dim.getBlock({ x, y, z })?.setPermutation(BlockPermutation.resolve(mush));
      }
    }

  } else if (biome === 4) {
    // ── Nether-like ───────────────────────────────────────────────────────────
    if (wantsTree && hash(x, z, 740 + S) % 2 === 0) {
      const crimson = hash(x, z, 741 + S) % 2 === 0;
      placeNetherFungus(dim, x, y, z, S, crimson);
    } else if (wantsFlora) {
      const r = hash(x, z, 742 + S) % 4;
      if (r === 0) dim.getBlock({ x, y, z })?.setPermutation(BlockPermutation.resolve("minecraft:nether_sprouts"));
      else if (r === 1) dim.getBlock({ x, y, z })?.setPermutation(BlockPermutation.resolve("minecraft:crimson_roots"));
      else if (r === 2) dim.getBlock({ x, y, z })?.setPermutation(BlockPermutation.resolve("minecraft:warped_roots"));
    }
    // Lava pillar / blaze spire
    if (hash(x, z, 743 + S) % 80 === 0) {
      const pillarH = 3 + (hash(x, z, 744 + S) % 6);
      const netherrack = BlockPermutation.resolve("minecraft:netherrack");
      for (let py = 0; py < pillarH; py++)
        dim.getBlock({ x, y: y + py, z })?.setPermutation(netherrack);
    }

  } else if (biome === 5) {
    // ── Savanna ──────────────────────────────────────────────────────────────
    if (wantsTree && hash(x, z, 750 + S) % 4 === 0) {
      placeAcaciaTree(dim, x, y, z, S);
    } else if (wantsFlora) {
      const r = hash(x, z, 751 + S) % 5;
      if (r < 2) {
        dim.getBlock({ x, y, z })?.setPermutation(BlockPermutation.resolve("minecraft:tall_grass"));
        dim.getBlock({ x, y, z })?.setPermutation(BlockPermutation.resolve("minecraft:tall_grass"));
      }
      else if (r === 2) dim.getBlock({ x, y, z })?.setPermutation(BlockPermutation.resolve("minecraft:dandelion"));
    }
  }
}

// =============================================================================
// TREE BUILDERS
// =============================================================================

function placeOakTree(dim, x, y, z, S) {
  const log = BlockPermutation.resolve("minecraft:oak_log");
  const leaves = BlockPermutation.resolve("minecraft:oak_leaves");
  const h = 4 + (hash(x, z, 800 + S) % 3);
  for (let ty = 0; ty < h; ty++)
    dim.getBlock({ x, y: y + ty, z })?.setPermutation(log);
  for (let lx = -2; lx <= 2; lx++)
    for (let lz = -2; lz <= 2; lz++)
      for (let ly = h - 2; ly <= h + 1; ly++)
        if (Math.abs(lx) + Math.abs(lz) + Math.abs(ly - h) < 5)
          dim.getBlock({ x: x + lx, y: y + ly, z: z + lz })?.setPermutation(leaves);
}

function placeBirchTree(dim, x, y, z, S) {
  const log = BlockPermutation.resolve("minecraft:birch_log");
  const leaves = BlockPermutation.resolve("minecraft:birch_leaves");
  const h = 5 + (hash(x, z, 810 + S) % 3);
  for (let ty = 0; ty < h; ty++)
    dim.getBlock({ x, y: y + ty, z })?.setPermutation(log);
  for (let lx = -1; lx <= 1; lx++)
    for (let lz = -1; lz <= 1; lz++)
      for (let ly = h - 2; ly <= h + 1; ly++)
        if (lx !== 0 || lz !== 0 || ly >= h)
          dim.getBlock({ x: x + lx, y: y + ly, z: z + lz })?.setPermutation(leaves);
}

function placeSpruceTree(dim, x, y, z, S) {
  const log = BlockPermutation.resolve("minecraft:spruce_log");
  const leaves = BlockPermutation.resolve("minecraft:spruce_leaves");
  const h = 7 + (hash(x, z, 820 + S) % 4);
  for (let ty = 0; ty < h; ty++)
    dim.getBlock({ x, y: y + ty, z })?.setPermutation(log);
  // Layered conical canopy
  const layers = [[1, h - 1], [2, h - 3], [2, h - 5], [1, h - 7]];
  for (const [r, relY] of layers) {
    if (relY < 0) continue;
    for (let lx = -r; lx <= r; lx++)
      for (let lz = -r; lz <= r; lz++)
        if (lx !== 0 || lz !== 0)
          dim.getBlock({ x: x + lx, y: y + relY, z: z + lz })?.setPermutation(leaves);
  }
  dim.getBlock({ x, y: y + h, z })?.setPermutation(leaves);
}

function placeBigOakTree(dim, x, y, z, S) {
  const log = BlockPermutation.resolve("minecraft:dark_oak_log");
  const leaves = BlockPermutation.resolve("minecraft:dark_oak_leaves");
  const h = 6 + (hash(x, z, 830 + S) % 4);
  for (let ty = 0; ty < h; ty++)
    dim.getBlock({ x, y: y + ty, z })?.setPermutation(log);
  // Spread-out wide canopy
  for (let lx = -3; lx <= 3; lx++)
    for (let lz = -3; lz <= 3; lz++)
      for (let ly = h - 2; ly <= h + 1; ly++)
        if (lx * lx + lz * lz <= 10 && (lx !== 0 || lz !== 0 || ly > h - 2))
          dim.getBlock({ x: x + lx, y: y + ly, z: z + lz })?.setPermutation(leaves);
}

function placeAcaciaTree(dim, x, y, z, S) {
  const log = BlockPermutation.resolve("minecraft:acacia_log");
  const leaves = BlockPermutation.resolve("minecraft:acacia_leaves");
  const h = 5 + (hash(x, z, 840 + S) % 3);
  // Slight lean
  const leanX = (hash(x, z, 841 + S) % 3) - 1;
  for (let ty = 0; ty < h; ty++)
    dim.getBlock({ x: x + (ty > h / 2 ? leanX : 0), y: y + ty, z })?.setPermutation(log);
  const topX = x + leanX;
  for (let lx = -2; lx <= 2; lx++)
    for (let lz = -2; lz <= 2; lz++)
      if (Math.abs(lx) + Math.abs(lz) <= 3)
        dim.getBlock({ x: topX + lx, y: y + h, z: z + lz })?.setPermutation(leaves);
  for (let lx = -1; lx <= 1; lx++)
    for (let lz = -1; lz <= 1; lz++)
      dim.getBlock({ x: topX + lx, y: y + h - 1, z: z + lz })?.setPermutation(leaves);
}

function placeNetherFungus(dim, x, y, z, S, crimson) {
  const stem = BlockPermutation.resolve(crimson ? "minecraft:crimson_stem" : "minecraft:warped_stem");
  const wart = BlockPermutation.resolve(crimson ? "minecraft:nether_wart_block" : "minecraft:warped_wart_block");
  const h = 4 + (hash(x, z, 850 + S) % 4);
  for (let ty = 0; ty < h; ty++)
    dim.getBlock({ x, y: y + ty, z })?.setPermutation(stem);
  // Cap
  for (let lx = -2; lx <= 2; lx++)
    for (let lz = -2; lz <= 2; lz++)
      if (lx * lx + lz * lz <= 5)
        dim.getBlock({ x: x + lx, y: y + h, z: z + lz })?.setPermutation(wart);
  for (let lx = -1; lx <= 1; lx++)
    for (let lz = -1; lz <= 1; lz++)
      dim.getBlock({ x: x + lx, y: y + h - 1, z: z + lz })?.setPermutation(wart);
}

// =============================================================================
// TELEPORT TO TERRA
// =============================================================================

async function teleportToTerra(player) {
  const selection = await showTerraSlotMenu(player);
  if (selection === undefined) return;

  let slot;

  if (selection === null) {
    const newWorld = await showTerraNewWorldForm(player);
    if (!newWorld) { player.sendMessage("\u00A77Cancelled."); return; }

    const freeIndex = terraNextFreeIndex();
    if (freeIndex === -1) {
      player.sendMessage("\u00A7cAll " + TERRA_MAX_WORLDS + " world slots are full.");
      return;
    }

    slot = { index: freeIndex, name: newWorld.name, config: newWorld.config };
    const slots = terraLoadSlots();
    slots.push(slot);
    terraSaveSlots(slots);
    player.sendMessage("\u00A72World \u00A7f\u00A7l" + slot.name + "\u00A7r\u00A72 created!");
  } else {
    slot = selection;
  }

  const dim = world.getDimension(terraSlotDimId(slot.index));
  const spawn = TERRA_SPAWN;
  const areaId = `terra_tp_${slot.index}_${player.id}`;
  const state = terraSlotState[slot.index];

  player.sendMessage("\u00A72Generating \u00A7f\u00A7l" + slot.name + "\u00A7r\u00A72...");

  await world.tickingAreaManager.createTickingArea(areaId, {
    dimension: dim,
    from: { x: spawn.x - 16, y: TERRA_BEDROCK_Y, z: spawn.z - 16 },
    to: { x: spawn.x + 16, y: TERRA_SEA_Y + 60, z: spawn.z + 16 },
  });

  const pcx = toChunk(spawn.x);
  const pcz = toChunk(spawn.z);
  const jobs = [];
  for (let dx = -2; dx <= 2; dx++) {
    for (let dz = -2; dz <= 2; dz++) {
      const key = chunkKey(pcx + dx, pcz + dz);
      if (!state.generatedChunks.has(key)) {
        state.generatedChunks.add(key);
        jobs.push(runTerraChunk(slot.index, slot.config, pcx + dx, pcz + dz));
      }
    }
  }
  await Promise.all(jobs);

  // Find first solid block above bedrock at spawn column
  let spawnY = TERRA_SEA_Y + 5;
  for (let sy = TERRA_SEA_Y + 60; sy >= TERRA_BEDROCK_Y; sy--) {
    const block = dim.getBlock({ x: spawn.x, y: sy, z: spawn.z });
    if (block && block.typeId !== "minecraft:air") { spawnY = sy + 2; break; }
  }

  player.teleport({ x: spawn.x, y: spawnY, z: spawn.z }, { dimension: dim });
  system.runTimeout(() => {
    player.runCommand("fog @s remove custom_fog");
    player.runCommand("fog @s push minecraft:fog_bamboo_jungle fog_override");
  }, 5);
  dim.runCommand(`time set ${slot.config.timeOfDay}`);

  player.sendMessage(
    "\u00A72\u00A7lWelcome to \u00A7f" + slot.name +
    "\u00A7r\u00A72. Use /travel:portal to leave."
  );

  world.tickingAreaManager.removeTickingArea(areaId);
}

// =============================================================================
// SECTION 6 – TRAVEL UI
// =============================================================================

const DESTINATIONS = [
  {
    id: UMBRA_ID,
    name: "\u00A75Umbra Depths",
    desc: "Warden's realm. Sculk, darkness, and ancient ruins.",
    spawn: UMBRA_SPAWN,
    type: "umbra",
  },
  {
    id: AETHER_ID,
    name: "\u00A7bAether Expanse",
    desc: "Infinite floating islands. Three island biomes, generates as you explore.",
    spawn: AETHER_SPAWN,
    type: "aether",
  },
  {
    id: "terra:world_0",
    name: "\u00A72Terra Genesis",
    desc: "Your worlds, your rules. Up to 8 custom worlds, each in its own dimension.",
    spawn: { x: 0, y: 90, z: 0 },
    type: "terra",
  },
  {
    id: "minecraft:overworld",
    name: "\u00A7aOverworld",
    desc: "The surface world.",
    spawn: { x: 0, y: 64, z: 0 },
    type: "vanilla",
  },
  {
    id: "minecraft:nether",
    name: "\u00A74The Nether",
    desc: "Fire and lava.",
    spawn: { x: 0, y: 64, z: 0 },
    type: "vanilla",
  },
  {
    id: "minecraft:the_end",
    name: "\u00A78The End",
    desc: "Void and dragons.",
    spawn: { x: 100, y: 64, z: 0 },
    type: "vanilla",
  },
];

function showTravelMenu(player) {
  const currentId = player.dimension.id;

  const form = new ActionFormData()
    .title("\u00A7l\u00A7eDimension Travel")
    .body(
      "\u00A77Current: \u00A7f" + currentId + "\n\n" +
      "\u00A77Choose a destination:"
    );

  for (const dest of DESTINATIONS) {
    const tag = dest.id === currentId ? " \u00A78(here)" : "";
    form.button(dest.name + tag + "\n\u00A78" + dest.desc);
  }

  form.show(player).then((response) => {
    if (response.canceled || response.selection === undefined) return;

    const dest = DESTINATIONS[response.selection];

    if (dest.id === currentId) {
      player.sendMessage("\u00A77You are already in this dimension.");
      return;
    }

    if (dest.type === "terra") {
      void teleportToTerra(player);
    } else if (dest.type === "umbra" || dest.type === "aether") {
      void teleportToCustomDim(player, dest);
    } else {
      system.run(() => {
        player.teleport(dest.spawn, { dimension: world.getDimension(dest.id) });
        system.runTimeout(() => {
          player.runCommand("fog @s remove custom_fog");
          player.runCommand("fog @s push minecraft:fog_bamboo_jungle fog_override");
        }, 5);
        player.sendMessage("\u00A77Teleported to " + dest.name + "\u00A7r.");
      });
    }
  });
}

async function teleportToCustomDim(player, dest) {
  const dim = world.getDimension(dest.id);
  const spawn = dest.spawn;
  const areaId = dest.id.replace(":", "_") + "_tp_" + player.id;

  player.sendMessage("\u00A77Loading " + dest.name + "\u00A77...");

  await world.tickingAreaManager.createTickingArea(areaId, {
    dimension: dim,
    from: { x: spawn.x - 8, y: spawn.y - 4, z: spawn.z - 8 },
    to: { x: spawn.x + 8, y: spawn.y + 8, z: spawn.z + 8 },
  });

  if (dest.id === UMBRA_ID) await buildUmbraDepths();

  if (dest.id === AETHER_ID) {
    const pcx = toChunk(spawn.x);
    const pcz = toChunk(spawn.z);
    const spawnJobs = [];
    for (let dx = -1; dx <= 1; dx++) {
      for (let dz = -1; dz <= 1; dz++) {
        const key = chunkKey(pcx + dx, pcz + dz);
        if (!aetherGeneratedChunks.has(key)) {
          aetherGeneratedChunks.add(key);
          spawnJobs.push(runAetherChunk(pcx + dx, pcz + dz));
        }
      }
    }
    await Promise.all(spawnJobs);
    await new Promise((resolve) => system.runTimeout(resolve, 2));
  }

  player.teleport(spawn, { dimension: dim });
  player.sendMessage("\u00A7l" + dest.name + "\u00A7r\u00A77. Use /travel:portal to return.");

  world.tickingAreaManager.removeTickingArea(areaId);
}
