// "Ricky Jackson-Lewis and Sandy going" instead of "2 people going".
//
// A count tells you how many; a name tells you who, and who is the thing that
// decides whether you turn up. Everyone, yourself included, shows by name —
// RIVAL uses your real name throughout rather than "You".
export function formatAttendees(
  userIds: string[],
  _currentUserId: string,
  nameFor: (id: string) => string,
): string {
  if (userIds.length === 0) return 'No attendees yet';

  const names = userIds.map(nameFor);

  // Two names fit comfortably; past that the row would wrap, so the rest
  // collapse into a count.
  if (names.length === 1) return `${names[0]} going`;
  if (names.length === 2) return `${names[0]} and ${names[1]} going`;
  return `${names[0]}, ${names[1]} and ${names.length - 2} more going`;
}
