// Vertical player physics. One world unit = one meter, so real-world numbers apply.
//
// The mech jumps with a rocket booster: a quick tap is a small hop, and holding the
// button keeps the booster burning so you keep climbing, up to MAX_RISE above where
// you took off. Releasing cuts the burn and you coast up and fall under gravity.
export const GRAVITY = 9.81;                 // m/s^2, standard Earth gravity
export const JUMP_HEIGHT = 0.5;              // m, the hop you get from a quick tap
export const JUMP_SPEED = Math.sqrt(2 * GRAVITY * JUMP_HEIGHT);   // ~3.13 m/s takeoff speed
export const THRUST_ACCEL = 2 * GRAVITY;     // booster acceleration (net climb is THRUST_ACCEL - GRAVITY = 1 g)
export const THRUST_DELAY = 0.12;            // s you must hold before the booster ignites; shorter presses stay a hop
export const MAX_RISE = 5;                   // m above the takeoff point
export const BOOST_SPEED = 6.5;              // m/s added to your climb by the double-tap boost
export const BOOST_RISE = 3;                 // m the boost adds to the climb limit (so up to MAX_RISE + BOOST_RISE)
export const BOOST_MIN_AIR = 0.06;           // s after takeoff before a second tap counts as the boost (not the same press)
const SNAP_DOWN = 0.6;                       // a drop bigger than this makes you airborne (walk off a ledge)

const advance = (s, accel, t) => { s.y += s.vy * t + 0.5 * accel * t * t; s.vy += accel * t; };   // exact for constant acceleration

// A second tap in the air fires the boost once per jump: it adds BOOST_SPEED to your climb and raises
// the climb limit by BOOST_RISE. Any further taps before you land do nothing.
//
// state: { y, vy, grounded, thrusting, hold, capY, boosted, airTime, jumpedUp, boostFired }; groundY: eye height of the
// ground below. jumpRequested is a fresh press (jump on the ground, boost in the air). Returns true when that press
// was used (a jump or a boost) so the caller can clear its input buffer.
export function stepVertical(state, groundY, dt, jumpRequested, jumpHeld = false) {
  let jumped = false;
  state.boostFired = false;
  if (state.grounded) {
    if (jumpRequested) {
      state.vy = JUMP_SPEED;
      state.grounded = false;
      state.thrusting = true;                // armed: one burn per jump
      state.hold = 0;
      state.capY = state.y + MAX_RISE;
      state.boosted = false;
      state.jumpedUp = true;                 // only a real jump can be boosted, not a fall off a ledge
      state.airTime = 0;
      jumped = true;
    } else if (state.y - groundY > SNAP_DOWN) {
      state.grounded = false;                // ground fell away: start falling
      state.vy = 0;
      state.thrusting = false;
      state.jumpedUp = false;
    } else {
      state.y += (groundY - state.y) * Math.min(1, dt * 12);   // glide over slopes
      state.vy = 0;
      state.thrusting = false;
      return false;
    }
  }

  // double-tap boost
  if (!jumped && jumpRequested && state.jumpedUp && !state.boosted && state.airTime >= BOOST_MIN_AIR) {
    state.boosted = true;
    state.boostFired = true;
    state.capY += BOOST_RISE;
    const room = Math.max(0, state.capY - state.y);                       // never boost past the raised limit
    state.vy = Math.min(Math.max(state.vy, 0) + BOOST_SPEED, Math.sqrt(2 * GRAVITY * room));
    state.thrusting = !!jumpHeld;                                         // keep burning if the button is still down
    state.hold = THRUST_DELAY;                                            // no ignition delay the second time
    jumped = true;
  }
  state.airTime = (state.airTime || 0) + dt;

  let rem = dt;
  if (state.thrusting) {
    if (!jumpHeld || state.vy < 0) state.thrusting = false;      // released, or already past the top
    else {
      const wait = Math.min(rem, Math.max(0, THRUST_DELAY - state.hold));   // ignition delay
      if (wait > 0) { advance(state, -GRAVITY, wait); rem -= wait; state.hold += wait; }
      if (rem > 0) {
        // Burn only as long as coasting afterward still tops out at capY. Solve for the burn time tau
        // where y(tau) + vy(tau)^2 / 2g = capY, with net acceleration a = THRUST_ACCEL - g.
        const T = THRUST_ACCEL, a = T - GRAVITY;
        const c2 = (a * T) / (2 * GRAVITY), c1 = (state.vy * T) / GRAVITY;
        const c0 = state.y + (state.vy * state.vy) / (2 * GRAVITY) - state.capY;
        if (c0 >= 0) state.thrusting = false;                    // already on course for the cap
        else {
          const tau = (-c1 + Math.sqrt(c1 * c1 - 4 * c2 * c0)) / (2 * c2);
          if (tau >= rem) { advance(state, a, rem); state.hold += rem; rem = 0; }
          else { advance(state, a, tau); rem -= tau; state.thrusting = false; }
        }
      }
    }
  }
  if (rem > 0) advance(state, -GRAVITY, rem);

  if (state.vy <= 0 && state.y <= groundY) {   // landed
    state.y = groundY;
    state.vy = 0;
    state.grounded = true;
    state.thrusting = false;
    state.jumpedUp = false;
    state.boosted = false;
  }
  return jumped;
}
