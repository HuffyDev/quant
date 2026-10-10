# Baby Brain

**You raise it. It runs the coin.** A newborn AI is born when a Solana memecoin launches and develops in public. Every unlock is real, every action is linked, and a deterministic Guardian checks every move it makes with the treasury.

- Spec: [`BABY_BRAIN_SPEC.md`](./BABY_BRAIN_SPEC.md)
- **Setup, env vars, sim & live modes, Replit deploy: [`SETUP.md`](./SETUP.md)**

Quick start (sim, no keys needed):

```bash
cp .env.example .env     # set DATABASE_URL + ADMIN_TOKEN
npm ci
npm run build && npm start   # http://localhost:5000  → /admin → "RUN FULL FIRST HOUR"
npm test
```
