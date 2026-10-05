import type { CareerSeat, Membership } from "./queries";

// Shapes returned by the public API: internal numeric ids stay server-side.
export function publicMembership(m: Membership) {
  const { membership_id, person_id, review_status, ...rest } = m;
  void membership_id;
  void person_id;
  void review_status;
  return rest;
}

export function publicSeat(s: CareerSeat) {
  return publicMembership(s);
}
