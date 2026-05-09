export const footballTags = {
  quarterback: [
    { name: "Touchdown Pass", description: "Completed pass that results in a score." },
    { name: "Deep Ball", description: "Accurate throws of 20+ yards downfield." },
    { name: "Scramble", description: "Evading pressure to extend the play or gain yards." },
  ],
  wide_receiver: [
    { name: "Touchdown Catch", description: "Receiving a pass in the end zone for a score." },
    { name: "Route Running", description: "Crisp cuts and separation from defenders on passing routes." },
    { name: "YAC", description: "Yards after catch; gaining extra ground after the reception." },
  ],
  running_back: [
    { name: "Touchdown Run", description: "Rushing the ball into the end zone for a score." },
    { name: "Broken Tackle", description: "Breaking through or spinning off a defender's tackle attempt." },
    { name: "Receiving", description: "Catching passes out of the backfield." },
  ],
  offensive_line: [
    { name: "Pancake Block", description: "Driving a defender flat to the ground." },
    { name: "Pass Protection", description: "Keeping the pocket clean for the quarterback." },
  ],
  defensive_line: [
    { name: "Sack", description: "Tackling the quarterback behind the line of scrimmage." },
    { name: "TFL", description: "Tackle for loss; stopping the ball carrier behind the line." },
    { name: "Run Stop", description: "Stuffing a run play at or near the line of scrimmage." },
  ],
  linebacker: [
    { name: "Tackle", description: "Bringing down the ball carrier in the open field." },
    { name: "Blitz", description: "Rushing the quarterback from a linebacker position." },
    { name: "Coverage", description: "Defending a pass from a linebacker position." },
  ],
  defensive_back: [
    { name: "Interception", description: "Catching a pass intended for the offense." },
    { name: "Pass Breakup", description: "Deflecting or disrupting a pass without intercepting." },
    { name: "Tackle", description: "Bringing down the ball carrier in the open field." },
  ],
  kicker: [
    { name: "Field Goal", description: "Successful kick through the uprights for 3 points." },
    { name: "Punt", description: "Booming kicks that pin the opponent deep." },
    { name: "Kickoff", description: "Strong kicks that limit return yardage." },
  ],
};

export const positions = [
  { id: 'quarterback', name: 'Quarterback' },
  { id: 'wide_receiver', name: 'Wide Receiver / Tight End' },
  { id: 'running_back', name: 'Running Back' },
  { id: 'offensive_line', name: 'Offensive Line' },
  { id: 'defensive_line', name: 'Defensive Line' },
  { id: 'linebacker', name: 'Linebacker' },
  { id: 'defensive_back', name: 'Defensive Back' },
  { id: 'kicker', name: 'Kicker / Punter' },
];
