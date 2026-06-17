export const volleyballTags = {
  setter: [
    { name: "Set", description: "Accurate sets that put hitters in position to attack." },
    { name: "Assist", description: "Set that directly leads to a teammate's kill." },
    { name: "Dump", description: "Surprise second-touch attack over the net." },
  ],
  hitter: [
    { name: "Kill", description: "Attack that lands for a point or forces an error." },
    { name: "Tip", description: "Soft touch placed past or over the block." },
    { name: "Ace", description: "Serve that lands for a point untouched or unreturned." },
  ],
  middle_blocker: [
    { name: "Block", description: "Stopping an opponent's attack at the net." },
    { name: "Slide", description: "Quick attack off a one-foot approach behind the setter." },
    { name: "Stuff Block", description: "Block that sends the ball straight back for a point." },
  ],
  libero: [
    { name: "Dig", description: "Defensive save of a hard-driven attack." },
    { name: "Serve Receive", description: "Clean pass off the opponent's serve to the setter." },
    { name: "Pancake", description: "Diving one-hand floor save to keep the rally alive." },
  ],
};

export const positions = [
  { id: 'setter', name: 'Setter' },
  { id: 'hitter', name: 'Hitter' },
  { id: 'middle_blocker', name: 'Middle Blocker' },
  { id: 'libero', name: 'Libero' },
];
