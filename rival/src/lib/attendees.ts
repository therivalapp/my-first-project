// "Sandy and Emma going" instead of "2 people going".
//
// A count tells you how many; a name tells you who, and who is the thing that
// decides whether you turn up. Yourself always reads as "You", and always
// comes first — seeing your own name in a list of other people is jarring.
export function formatAttendees(
  userIds: string[],
  currentUserId: string,
  nameFor: (id: string) => string,
): string {
  if (userIds.length === 0) return 'No one yet';

  const isGoing = userIds.includes(currentUserId);
  const others = userIds.filter((id) => id !== currentUserId).map(nameFor);
  const names = isGoing ? ['You', ...others] : others;

  // Two names fit comfortably; past that the row would wrap, so the rest
  // collapse into a count.
  let list: string;
  if (names.length === 1) list = names[0];
  else if (names.length === 2) list = `${names[0]} and ${names[1]}`;
  else list = `${names[0]}, ${names[1]} and ${names.length - 2} more`;

  // "You going" is wrong; everything else takes the plain verb.
  if (isGoing && names.length === 1) return "You're going";
  return `${list} going`;
}
