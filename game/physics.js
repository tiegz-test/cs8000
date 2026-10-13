// Vertical player physics. One world unit = one meter, so real-world numbers apply.
export const GRAVITY = 9.81;                 // m/s^2, standard Earth gravity
export const JUMP_HEIGHT = 0.5;              // m, a typical standing vertical jump
export const JUMP_SPEED = Math.sqrt(2 * GRAVITY * JUMP_HEIGHT);   // ~3.13 m/s takeoff speed
const SNAP_DOWN = 0.6;                       // a drop bigger than this makes you airborne (walk off a ledge)

// state: { y, vy, grounded }; groundY: eye height of the ground below.
// Returns true on the step the player leaves the ground by jumping.
export function stepVertical(state, groundY, dt, jumpRequested) {
  let jumped = false;
  if (state.grounded) {
    if (jumpRequested) {
      state.vy = JUMP_SPEED;
      state.grounded = false;
      jumped = true;
    } else if (state.y - groundY > SNAP_DOWN) {
      state.grounded = false;                // ground fell away: start falling
      state.vy = 0;
    } else {
      state.y += (groundY - state.y) * Math.min(1, dt * 12);   // glide over slopes
      state.vy = 0;
      return false;
    }
  }
  // airborne: exact constant-acceleration step, so the arc doesn't depend on frame rate
  state.y += state.vy * dt - 0.5 * GRAVITY * dt * dt;
  state.vy -= GRAVITY * dt;
  if (state.vy <= 0 && state.y <= groundY) {   // landed
    state.y = groundY;
    state.vy = 0;
    state.grounded = true;
  }
  return jumped;
}
