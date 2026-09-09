# Spinning Tops

A physics-first Beyblade-style battler: build a top out of a few real physical
parameters, drop it into a designed arena, and let it play out. No gacha, no
special-cased "abilities," no animation to author - every part you customize is
just a number the simulation reads, and every arena is a composition of a
handful of generic force primitives. Kotlin end to end: a shared physics
engine, a self-hosted Ktor backend for PvP + a leaderboard, and an Android/
Compose client.

## Why this shape

The brief was: keep it simple, but let the physics carry the depth. Concretely:

- **A part is a physical quantity, not a hidden stat block.** `TopConfig` (see
  `core/src/main/kotlin/tops/physics/TopConfig.kt`) has exactly the fields a
  spinning top actually has: mass, radius, how the mass is distributed between
  the center and the rim (moment of inertia), how far off-center that mass
  sits, tip friction, lateral grip, and collision restitution. There is no
  code anywhere that special-cases "if part == X". Two tops with the same
  numbers play identically, always.
- **Real tradeoffs, not free variety.** Rim-weighted mass distribution
  resists spin-down and knockback (real physics: `I = k*m*r^2`), but the same
  inertia makes a top sluggish to redirect after a hit. An off-center mass
  induces a growing wobble as spin decays, so it topples earlier - a genuine
  cost for whatever else it buys you. See `Simulation.kt` for the exact
  equations; the doc comments there spell out the reasoning per force.
- **Arenas are composed, not hand-coded.** An arena is a wall + a parabolic
  "bowl" restoring force + a short list of generic zones (`Pit`, `Bumper`,
  `GripZone`). Three very differently-playing arenas ship in
  `server/src/main/kotlin/tops/server/arena/Arenas.kt` and none of them needed
  new code - only new placements of the same primitives.
- **The server is the only physics authority.** A match's outcome is computed
  once, server-side, the instant every player has submitted a launch. Clients
  never run PvP physics themselves and never need to agree on floating-point
  behavior with each other - they just replay the frames the server computed.
  (Practice mode is the one exception, by design: it runs the same
  `Simulation` locally so you can play solo with zero network dependency.)
- **No accounts, no email, no login.** A player types a display name once;
  the server hands back an id and a secret token, and only the token's hash
  is ever stored. That's deliberately lighter than real auth - see "Security
  model" below for why that's an appropriate tradeoff here and not elsewhere.

## Project layout

```
core/    pure Kotlin, no Android/server deps - physics engine + wire protocol.
         Runs identically on the JVM server and inside the Android app.
server/  Ktor backend: match orchestration, the authoritative simulation run,
         Postgres-backed leaderboard, Docker packaging.
app/     Android/Compose client: top builder, practice mode, online battles,
         leaderboard.
```

Splitting out `core` is what makes "the server is the only physics
authority" actually safe: the server can validate what a client's replay
*should* look like, and a client can run the identical solo-practice sim,
because there's exactly one implementation of the rules.

## The physics, in short

Each tick (`Simulation.step`, fixed 1/120s):

1. **Spin decay** - friction between the tip and the floor slows the spin.
   Mass cancels out of the decay rate (as it does physically - torque and
   inertia both scale with mass), so a heavier top doesn't spin longer, it
   just hits harder.
2. **Wobble/elimination** - below a spin-rate threshold a top topples. An
   off-center mass raises that threshold, i.e. makes it topple sooner.
3. **Arena forces** - a parabolic restoring force toward the center (the
   "bowl"), plus whatever `ArenaFeature`s the arena places: a `Bumper` pushes
   tops outward from a point, a `GripZone` multiplies effective grip
   (slick or rough patches), a `Pit` eliminates on contact.
4. **Grip damping** - lateral grip bleeds linear speed; low-grip tops drift
   and roam (attack), high-grip tops stay near their drop point (defense).
5. **Collisions** - an impulse-based bounce (using each top's mass and
   restitution) plus Coulomb friction at the contact point that trades spin
   for push, and vice versa, between the two tops. This is what makes tip
   friction and spin rate matter *during* a hit, not just before it.

All of it is unit-tested in `core/src/test/kotlin/tops/physics/SimulationTest.kt`
(spin decay direction and monotonicity, inertia-ratio comparisons, imbalance
vs. topple timing, ring-out vs. solid-wall arenas, collision stability, and a
full match simulation). Run with:

```
./gradlew :core:test
```

## Running the backend on your homelab

The server is a normal Ktor app with Postgres for durable state (leaderboard
+ completed match results); in-progress lobbies are just in-memory, which is
fine since they're short-lived.

```
docker compose up -d --build
```

This builds `server/Dockerfile` (multi-stage: Gradle build, then a bare JRE
image running the fat jar) and starts Postgres alongside it. By default it
binds `0.0.0.0:8081` - for a friends-only server, bind it to your Tailscale
interface instead so it's reachable over the tailnet but not the open LAN:

```
BIND_ADDRESS=$(tailscale ip -4) docker compose up -d --build
```

Point the Android app's "server address" field at
`http://<that-tailscale-ip>:8081`.

Environment variables (all optional, see `docker-compose.yml`):
`PORT`, `DB_URL`, `DB_DRIVER`, `DB_USER`, `DB_PASSWORD`, `POSTGRES_PASSWORD`,
`BIND_ADDRESS`.

### Security model

There's no email/password account system - a player registers a display name
once and gets back a secret token; only its SHA-256 hash is ever stored, and
every authenticated request needs both the player id and the token. That's
enough to stop one friend from impersonating another *on the same network*,
which is the actual threat model for a server that's only reachable over
Tailscale in the first place. It is **not** meant to resist a hostile public
internet - don't expose port 8081 outside your tailnet.

## Running the Android app

```
./gradlew :app:installDebug   # with a device/emulator attached
```

On first launch it asks for a display name and the server's Tailscale
address, registers once, and remembers both (`DataStore`, on-device only).

- **Build my top** - every slider is a direct `TopConfig` field; the "Balance"
  slider's range depends on the current radius exactly the way the physics
  requires (see `TopConfig`'s `require()` checks).
- **Practice (offline)** - taps to choose a drop point, then press-and-hold
  to charge power (Mario-Golf-strength-bar style); release launches. Runs
  `Simulation` locally, no server involved.
- **Battle (online)** - host a match (mode + arena) and share the match code,
  or join one with a code. Once everyone's launched, the server computes the
  match and every client replays the identical result.
- **Leaderboard** - wins/matches per player, pulled from the server.

## What wasn't verified in this environment

This was built in a sandbox with no Android SDK and no route to Google's
Maven repo (`dl.google.com` was unreachable), so:

- `:core` and `:server` were fully built, unit-tested, and smoke-tested here
  (register → create match → join → launch → authoritative simulation →
  result → leaderboard, all against a live instance; the exact fat jar the
  Dockerfile packages was also run standalone and verified to serve
  requests).
- `:app` (the Compose UI) could **not** be compiled here, since the Android
  Gradle Plugin and AndroidX artifacts live on Google's Maven repo. It was
  written and carefully reviewed by hand (including catching and fixing a
  Compose scope-receiver bug in `OnlineMatchScreen.kt` during review), but
  you should do a build on a normal machine (`./gradlew :app:assembleDebug`)
  before trusting it fully.
- Building the actual Docker image wasn't possible either (no Docker daemon
  in this sandbox) - only the fat jar it packages was verified.

## Known simplifications / good next steps

- A match that hits the time limit with more than one top still standing
  currently counts as a draw where everyone survives (handled without
  crashing, just worth knowing about).
- Replay rendering on the client uses a fixed visual radius per top, since
  per-top radius isn't currently threaded through the match-complete payload
  the same way position/spin are - trivial to add if it bothers you.
- The server already exposes a match WebSocket for push-based lobby/result
  updates; the Android client currently just polls once a second instead,
  which is simpler and plenty responsive for a small friends server, but the
  socket is there if you want a snappier lobby later.
