export const flagFootballTags = {
  quarterback: [
    { name: "Touchdown Pass", description: "Completed pass that results in a score." },
    { name: "Scramble", description: "Evading rushers to extend the play or gain yards." },
    { name: "Play Action", description: "Fake handoff that freezes the defense before a pass." },
  ],
  receiver: [
    { name: "Touchdown Catch", description: "Receiving a pass in the end zone for a score." },
    { name: "Route Running", description: "Crisp cuts and separation from defenders on passing routes." },
    { name: "YAC", description: "Yards after catch; gaining extra ground after the reception." },
  ],
  center: [
    { name: "Snap", description: "Clean snaps that start the play on time." },
    { name: "Block", description: "Positioning to shield the quarterback from rushers." },
    { name: "Route", description: "Center releasing into a passing route after the snap." },
  ],
  rusher: [
    { name: "Sack", description: "Pulling the quarterback's flag behind the line of scrimmage." },
    { name: "Pressure", description: "Forcing the quarterback into a hurried throw or scramble." },
    { name: "Flag Pull", description: "Pulling the ball carrier's flag to end the play." },
  ],
  defensive_back: [
    { name: "Interception", description: "Catching a pass intended for the offense." },
    { name: "Pass Breakup", description: "Deflecting or disrupting a pass without intercepting." },
    { name: "Flag Pull", description: "Pulling the ball carrier's flag to end the play." },
  ],
};

export const positions = [
  { id: 'quarterback', name: 'Quarterback' },
  { id: 'receiver', name: 'Receiver' },
  { id: 'center', name: 'Center' },
  { id: 'rusher', name: 'Rusher' },
  { id: 'defensive_back', name: 'Defensive Back' },
];
