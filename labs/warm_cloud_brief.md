# Warm Cloud Simulator: Build Brief

```
Created: 2026-10-05
Last updated: 2026-10-05
Version: 1.0
```

A self-contained brief for building a physically based cloud lab in the FractalGaming repo. It was written in a cloud session that surveyed the existing cloud labs; a new session needs nothing beyond this file and the repo.

---

## 0. How to use this brief

Save this file in the FractalGaming repo (for example `docs/warm_cloud_brief.md`), then open a Claude Code session there and start with:

> Read docs/warm_cloud_brief.md. Build Milestone 1 as `labs/warm_cloud_lab.html`, starting from a copy of `labs/fluid_cloud_lab.html`. Keep the original file untouched. Stop when Milestone 1's acceptance checks pass and show me.

Build one milestone at a time. Each milestone has acceptance checks; do not start the next one until they pass.

---

## 1. Goal

A single-file browser lab (matching the existing `labs/*.html` style: one HTML file, slider panel, HUD) in which clouds **form, grow, rain and evaporate from thermodynamics**, instead of being painted with noise. The clouds should appear by themselves, with flat bases at the physically correct height, billowing tops, and edges that evaporate. Later milestones add rain, cold outflows that trigger new cells, droplets that form on seeds, ship tracks, and fractal fine detail.

---

## 2. What already exists (survey of the repo, 2026-10-05)

- **Noise fields drawn by raymarching, with nothing evolving:** `labs/eml_cloud_lab.html`, `labs/eml_cloud_field_lab.html`, `labs/eml_cloud_fly_webgpu.html`, `Caverns/caverns_clouds_webgpu.html`, `labs/sky_weather_sim_webgpu.html`. They have good lighting (sun self-shadowing, powder edge term, two-lobe scattering), but wind is a scrolling offset and the clouds never read the terrain.
- **Particles with no forces between them:** `labs/cloud_sim.html`, `labs/particle_cloud_break_lab.html`, `labs/particle_cloud_break_lab_3d.html`.
- **Grid fluid solvers:**
  - `labs/cloud_lab.html`: CPU, 32x24x32, stable fluids.
  - `labs/fluid_cloud_lab.html`: WebGL2, 64^3, MacCormack advection, Jacobi pressure solve, vorticity confinement, raymarch with a sun shadow. **This is the closest to physical and the starting point.**
- **Modeled nowhere:** temperature, water vapor, saturation, condensation and evaporation, latent heat, cooling of rising air, heating from the ground, evaporation at cloud edges, rain.
- **The key inversion to fix:** buoyancy is currently driven by the visible density (`labs/fluid_cloud_lab.html` around line 145: `res.y += res.w * uBuoyancy * 0.08`; `labs/cloud_lab.html` around line 162 does the same). In real clouds the condensed water is a weight. The lift comes from warm air, from water vapor being lighter than dry air, and from the heat released when vapor condenses.

---

## 3. Design principles

1. **The visible cloud is a passenger.** Render liquid cloud water `q_c`. Drive buoyancy from temperature and vapor, minus the weight of liquid water. Never make the visible field the buoyancy source.
2. **The cloud's edge is a level set.** Cloud exists where air is saturated (`q_c > 0`). Flat bases emerge by themselves at the height where rising air reaches saturation (the lifting condensation level). Do not paint bases or tops.
3. **Track wholes at one scale, fold the smaller scales into attributes, and treat the larger scale as the field.** The grid is the air (the field). Super-droplets (Milestone 4) each stand for a crowd of identical real droplets. Detail below the grid size is fractal statistics (Milestone 2).
4. **Every droplet has a center: its seed.** Droplets form on aerosol seeds (salt, dust, sulfate). When a droplet evaporates it returns its seed, slightly changed (Milestone 4).
5. **Fine detail should follow turbulence's scaling.** Use a noise gain of 2^(-1/3), about 0.794 per octave (Kolmogorov scaling, H = 1/3), not 0.5. The target cloud-edge fractal dimension is about 4/3 (Lovejoy 1982 measured 1.35).
6. **Use physical units** (meters, seconds, kelvin, kg of water per kg of air), with a display speed-up factor. Real constants then work without tuning.

---

## 4. Starting point: `labs/fluid_cloud_lab.html`

- **Copy** it to `labs/warm_cloud_lab.html`; leave the original as is.
- **Keep:**
  - the 64^3 grid, advection and pressure projection;
  - vorticity confinement, turned down, because real buoyancy will now do the work;
  - the raymarcher with its sun-shadow march, powder term and two-lobe phase function.
- **Replace:**
  - smoke density as the buoyancy driver;
  - the "EVAPORATION off the water" floor band (around lines 146 to 151), which emits *visible* density at the floor. Real evaporation emits invisible vapor and heat.
  - the side-wall "ventilation" (around lines 153 and 154). Use periodic side boundaries instead, which is standard for simulating a field of clouds.
- **Fix first (verify the intent before changing):** the MacCormack correction mask around line 122,
  ```glsl
  vec4 mask = vec4(0,0,0, isWall?1.0:0.0);
  res = advect(...) - error*mask;
  ```
  applies the correction only to the density channel and only in wall cells. The usual pattern is the reverse: correct every channel everywhere except at walls (and clamp the result to the min and max of the neighbors).
- **Channel packing suggestion:** texture A = `(u, v, w, theta_p)`, texture B = `(q_v, q_c, q_r, spare)`, both ping-ponged. Here `theta_p` is the potential-temperature perturbation from the base state.

---

## 5. Milestone 1: the thermodynamic warm cloud

### 5.1 Domain, units, time step

- **Default grid:** 64^3 cubic cells of 50 m, giving a 3.2 km cube. Shallow cumulus fit well inside it.
- **Wider alternative:** 100 m cells give a 6.4 km cube with more clouds per view at lower detail; Milestone 2 restores the detail.
- **Time step:** a physics substep of 1 to 2 s, keeping `max|u| * dt / dx < 0.5`. Do several substeps per frame; sim seconds per frame = substeps x dt, and make that a slider.
- **Approximation:** Boussinesq, which the existing incompressible projection already implements, is fine for clouds up to about 3 km. Deep thunderstorms would need anelastic (a density-weighted divergence); skip that for now.
- **Boundaries:** periodic sides; free-slip top and bottom (`w = 0`); a sponge layer in the top 10 to 15% of the domain that relaxes `u` and `theta_p` toward the base state, so gravity waves don't bounce off the lid.

### 5.2 Base state and initial sounding

Precompute per height level (64 values, stored as a uniform array or 1D texture):

- pressure `pbar(z) = p0 * exp(-z / 8400.0)` (adequate at these heights);
- Exner function `pi(z) = (pbar(z) / p0)^(Rd/cp)`, with `Rd/cp = 0.286`;
- base-state potential temperature `thbar(z)` and vapor `qvbar(z)` from the sounding below.

The initial sounding is BOMEX-like, the standard shallow-cumulus benchmark. The values below are approximate; check them against Siebesma et al. 2003 if you want the exact case.

| height | theta (K) | total water (g/kg) |
|---|---|---|
| 0 m | 298.7 | 17.0 |
| 520 m | 298.7 | 16.3 |
| 1480 m | 302.4 | 10.7 |
| 2000 m (top of inversion) | 308.2 | 4.2 |
| 3000 m | 311.85 | 3.0 |

- Interpolate linearly between rows. Initially there is no liquid, so `q_v = q_t`.
- Add small random perturbations (about +/-0.1 K and +/-0.025 g/kg) in the lower layers to break symmetry.
- **Surface fluxes**, applied to the lowest cell only:
  - sensible heat: `d theta_p/dt += F_theta / dz`, with `F_theta ~ 8e-3 K m/s`;
  - moisture: `d q_v/dt += F_q / dz`, with `F_q ~ 5.2e-5 (kg/kg) m/s`.
- Modulate the fluxes horizontally with low-frequency noise (warm patches, wet patches or "lakes") so thermals organize. For game speed, raise both fluxes.
- BOMEX also prescribes large-scale sinking motion and weak radiative cooling to hold a steady state. Skip them at first, and add them if the cloud layer slowly deepens over long runs.

### 5.3 Per-substep order

1. Advect `u`, `theta_p`, `q_v`, `q_c` (and later `q_r`) by `u`, using MacCormack with clamping.
2. Add the surface fluxes to the bottom layer.
3. Microphysics: saturation adjustment (condensation and evaporation) plus latent heating.
4. Add the buoyancy force to `w`.
5. Vorticity confinement, with a small coefficient.
6. Pressure projection: divergence, Jacobi iterations, gradient subtraction.
7. Apply the boundary conditions and the sponge.

### 5.4 Equations (GLSL-friendly)

```glsl
// temperature from potential temperature
float T  = (thbar(z) + theta_p) * pi(z);          // K
float Tc = T - 273.15;                            // deg C

// saturation mixing ratio (Bolton/Magnus), p in Pa, result in kg/kg
float qs = (380.2 / pbar(z)) * exp(17.67 * Tc / (Tc + 243.5));

// saturation adjustment: one linearized step (accounts for the heating that
// condensation causes, which raises qs)
float dq = (q_v - qs) / (1.0 + (L*L*qs) / (cp*Rv*T*T));
dq = max(dq, -q_c);                 // can only evaporate liquid that exists
// optional softening for nicer edges: dq *= min(1.0, dt / tau_c);  tau_c ~ 2-5 s
q_v -= dq;
q_c += dq;
theta_p += (L / (cp * pi(z))) * dq; // about +2.5 K per g/kg condensed

// buoyancy (Boussinesq, includes vapor lightness and liquid weight)
float b = g * ( theta_p / thbar(z)
              + 0.608 * (q_v - qvbar(z))
              - q_c - q_r );
w += b * dt;
```

### 5.5 Rendering

- Raymarch `q_c`, not a density field.
- Physical extinction for cloud droplets of effective radius `r_e` is `sigma = 1.5 * rho_air * q_c / (rho_w * r_e)`. With `r_e = 10e-6 m`, `rho_air = 1.1` and `rho_w = 1000`, that gives `sigma ~ 165 * q_c` per meter (`q_c` in kg/kg). So 0.5 g/kg gives about 0.08 per meter, an optical depth of about 40 through 500 m of cloud, which is realistic for cumulus.
- Keep the existing sun-shadow march, powder term and two-lobe Henyey-Greenstein phase function.
- Add debug slices: `theta_p`; supersaturation `q_v/qs - 1`; `w` (updraft red, downdraft blue).

### 5.6 Acceptance checks for Milestone 1

- [ ] Clouds appear on their own after a few simulated minutes, with flat bases at nearly the same height across the domain.
- [ ] Base height matches the lifting condensation level of the surface air, `z_LCL ~ 125 m * (T - T_dew)` (Espy's rule). For the BOMEX-like sounding, bases sit around 500 to 600 m.
- [ ] Tops billow and are capped near the inversion (about 1.5 to 2 km).
- [ ] Edges evaporate, with a thin shell of sinking air (negative `w`) just outside the cloud boundary.
- [ ] Turning latent heating off (a debug toggle) makes clouds clearly shallower and weaker. That proves the self-fueling feedback works.
- [ ] Total water `sum(q_v + q_c + q_r)` changes only through the surface flux (and rain-out, later). Log it every N steps.
- [ ] Runs at 60 fps at 64^3 on a mid-range desktop GPU; adjust substeps and Jacobi iterations if not.

---

## 6. Milestone 2: fractal detail below the grid

- At render time, modulate `q_c` with fractal noise whose octave gain is **0.794** (2^(-1/3)), with lacunarity 2 and 4 to 6 octaves below the grid scale.
- Advect the noise coordinates with the coarse velocity, so detail moves with the flow (the idea behind "Wavelet Turbulence", Kim et al. 2008). Periodically blend toward fresh coordinates to avoid over-stretching.
- Scale the noise amplitude by local resolved turbulence (for example, vorticity magnitude) and apply it mostly where `q_c` is small, so edges erode while cores stay solid.
- **Fractal check:** threshold a horizontal slice of the rendered cloud, measure each cloud's area A and perimeter P, and fit log P against log A. The slope is D/2. Expect D of about 1.3 to 1.4.

---

## 7. Milestone 3: warm rain and cold pools (Kessler scheme)

```
autoconversion: if q_c > 1e-3:  dq_r/dt += 1e-3 * (q_c - 1e-3)      // per second
accretion:                      dq_r/dt += 2.2 * q_c * pow(q_r, 0.875)
                                (take both amounts from q_c)
fall speed:     V = 36.34 * pow(1e-3 * rho_air * q_r, 0.1364)   // m/s, ~5-6 m/s at 1 g/kg
                (or start with a constant 5 m/s); move q_r down semi-Lagrangian
evaporation:    where q_v < qs, evaporate q_r at a rate ~ c * (qs - q_v) * sqrt(q_r)
                (tune c), cooling theta_p by L/(cp*pi) per unit evaporated
loading:        q_r is already in the buoyancy term
```

**Expected emergent behavior:**
- rain shafts;
- downdrafts cooled by evaporating rain;
- pools of cold air spreading along the ground;
- **new cells triggered where those cold pools push under warm air.** One cell's ending seeds the next.

---

## 8. Milestone 4: super-droplets with seeds

- **Particles (GPU buffer, about 50 to 200 per cloudy cell).** Each carries:
  - a position;
  - a multiplicity `xi`: how many real droplets it stands for;
  - a wet radius `r`;
  - a seed dry radius `r_d`;
  - a hygroscopicity `kappa` (about 1.2 for sea salt, 0.6 for ammonium sulfate).
- **Seed population:** lognormal dry radii (median about 50 nm, geometric spread about 1.5 to 2). Use about 100 to 300 seeds per cm^3 for clean ocean air and 1000 or more for polluted air.
- **Activation (kappa-Kohler):** critical supersaturation `s_c ~ sqrt(4*A^3 / (27*kappa*r_d^3))`, where `A ~ 1.1e-9 m` is the Kelvin (curvature) term at about 290 K. A 50 nm sulfate seed gives `s_c ~ 0.16%`. A droplet activates when the cell's supersaturation `s = q_v/qs - 1` exceeds `s_c`.
- **Growth:** `r dr/dt ~ G * (s - s_eq(r))`, with `G ~ 1e-10 m^2/s` and `s_eq(r) ~ A/r - kappa*r_d^3/r^3`. Integrate in `r^2` for stability: `r2 += 2*G*(s - s_eq)*dt`, and clamp `r >= r_d`.
- **Two-way coupling:** each step, sum the condensed mass per cell, `dm = sum xi * (4/3)*PI*rho_w*(r_new^3 - r_old^3)`. Convert it with `dq = dm / (rho_air * V_cell)`, subtract `dq` from `q_v`, and add the latent heat. `q_c` becomes total droplet mass per cell, which replaces saturation adjustment wherever droplets exist.
- **Death and memory:** when `r` shrinks back to about `r_d`, the droplet deactivates and the seed persists. Optionally grow `r_d` slightly each cycle, which mimics sulfate produced inside droplets ("cloud processing"). Air that has been through clouds then forms clouds differently the next time.
- **Collisions (later):** Shima et al. 2009's Monte Carlo pairing within each cell: random pairs, with a coalescence probability scaled by multiplicities and a collision kernel. This is where rain forms from the droplets themselves.
- **Ship tracks:** ships emit many small seeds (high `xi`, small `r_d`). That makes more, smaller droplets, a higher optical depth, and bright lines in low cloud (the Twomey effect). A natural visual for Last Ship Sailing.

---

## 9. Milestone 5: cheap upgrades for the stateless sky (eml labs, Caverns)

- **Physical cloud bases:** set the base height to `z_LCL = 125 m * (T_surface - T_dew_surface)`, using a per-region surface temperature and dew point.
- **Lift and moisture:** raise coverage where wind blows uphill (`dot(wind, grad(height)) > 0`, orographic lift) and downwind of lakes, and lower it in the lee of mountains (rain shadow). `Caverns/caverns_clouds_webgpu.html` already has terrain and lakes, but its cloud function never reads them.
- **Turbulent noise gain:** `labs/eml_cloud_fly_webgpu.html` lines 146 to 152 use 5 octaves with `a = a * 0.5`. Try `a = a * 0.794` and add 1 or 2 octaves. Caverns uses the same pattern (its `fbm` is around line 155).
- **Glory (bonus):** when the camera or a ship is above cloud with the sun behind it, add colored rings around the antisolar point, which is the viewer's own shadow on the cloud: red outside, bluish inside, a few degrees across, shrinking as droplets grow. Tune it visually. In reality each viewer sees a glory only around their own shadow, and pilots see one around their plane's shadow.

---

## 10. Bugs found in the survey

Verified:
- `labs/eml_cloud_field_lab.html` is cut off mid-statement on its last line (`gl.uniform1f(u.sun,+el.sun.`), so the page cannot load.
- `labs/fluid_cloud_lab.html` around line 122: the MacCormack mask (see section 4).
- `labs/cloud_lab.html` around line 259: buoyancy defaults to 0, so the gas never rises unless the slider is raised.
- `microverse_megabattle/v5.html` line 533: `getPairReaction` is defined but never called, so the declared form-water reaction never fires.

Reported by the survey, not yet verified:
- `labs/fluid3d_nested_lab.html` around line 190 re-centers the fine grid on the ship every frame without shifting its contents, so the "world-anchored" fluid travels with the ship.
- `labs/particle_cloud_break_lab.html` around line 136: `x += vx` is not scaled by the time step, so speed depends on frame rate.
- `labs/gpu_cloud.html` line 59: the `SUN` vector is defined but unused.

---

## 11. Constants

| symbol | value | meaning |
|---|---|---|
| g | 9.81 m/s^2 | gravity |
| cp | 1005 J/(kg K) | heat capacity of dry air |
| Rd | 287 J/(kg K) | gas constant, dry air |
| Rv | 461.5 J/(kg K) | gas constant, water vapor |
| L | 2.5e6 J/kg | latent heat of vaporization |
| p0 | 1.0e5 Pa | reference pressure |
| Rd/cp | 0.286 | Exner exponent |
| 0.608 | Rv/Rd - 1 | vapor buoyancy factor |
| rho_w | 1000 kg/m^3 | liquid water density |
| rho_air | ~1.1 kg/m^3 | air density near the surface |
| A | ~1.1e-9 m | Kelvin (curvature) coefficient, ~290 K |
| G | ~1e-10 m^2/s | droplet growth coefficient |
| Espy | 125 m per deg C | cloud base height per degree of dew-point depression |
| gain | 0.794 | turbulent fractal-noise octave gain, 2^(-1/3) |

---

## 12. References

- Harris, Baxter, Scheuermann, Lastra (2003), *Simulation of Cloud Dynamics on Graphics Hardware*, Graphics Hardware 2003. The GPU recipe for Milestone 1 (potential temperature, vapor, condensed water, buoyancy, latent heat). https://diglib.eg.org/handle/10.2312/EGGH.EGGH03.092-101
- Siebesma et al. (2003), *A large eddy simulation intercomparison study of shallow cumulus convection*, J. Atmos. Sci. The BOMEX case.
- Kessler (1969) warm-rain scheme, in the form used by Klemp and Wilhelmson (1978).
- Shima et al. (2009), *The super-droplet method for the numerical simulation of clouds and precipitation*. https://arxiv.org/abs/physics/0701103
- Petters and Kreidenweis (2007), the kappa-Kohler parameterization of seed activation.
- Kim, Thurey, James, Gross (2008), *Wavelet Turbulence for Fluid Simulation*, SIGGRAPH. https://www.cs.cornell.edu/~tedkim/WTURB
- Lovejoy (1982), *Area-perimeter relation for rain and cloud areas*, Science 216: 185-187 (cloud edge fractal dimension of about 1.35).
- Hentschel and Procaccia (1984), the fractal dimension of clouds (4/3) derived from turbulent diffusion, Phys. Rev. A 29: 1461.
- Heus and Jonker (2008), *Subsiding shells around shallow cumulus clouds*, J. Atmos. Sci. 65: 1003-1018.
- Bolton (1980), the saturation vapor pressure formula.

---

## 13. Framework notes (optional context)

These are the circumpunct readings that shaped the design. They are not needed to build it.

- **The cloud's boundary (○) is a level set of the greater whole's field:** the surface where the atmosphere's humidity crosses saturation, the boundary-field identification in physical form. Most exchange happens at that surface.
- **Nesting rule:** track wholes at one scale, fold the scales below into attributes, and treat the scale above as the field.
- **The seed is the droplet's center (•).** Water cannot gather into a droplet without a center to gather onto. Evaporation returning the seed is recursion, and the changed seed is a record of the cloud it lived through.
- **The glory:** every viewer gets their own ring of light around their own shadow, and no one can see anyone else's.

---

## Revision history

- 2026-10-05 v1.0: initial brief, from the cloud-physics session (repo survey, physics corrections, milestone plan).
