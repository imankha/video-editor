export const softballTags = {
  pitcher: [
    { name: "Strikeout", description: "Retiring a batter on a third strike." },
    { name: "Rise Ball", description: "A climbing riseball that gets a swing-and-miss." },
    { name: "Pickoff", description: "Throw that catches a baserunner off the bag for an out." },
  ],
  batter: [
    { name: "Home Run", description: "Hit that clears the fence for a run." },
    { name: "Hit", description: "Base hit that puts the batter safely on base." },
    { name: "Slap Hit", description: "Slapper contact on the move that beats out a hit." },
    { name: "RBI", description: "At-bat that drives in a run." },
  ],
  infielder: [
    { name: "Fielding", description: "Clean glove work on a ground ball for an out." },
    { name: "Double Play", description: "Turning two outs on a single batted ball." },
    { name: "Throw Out", description: "Strong throw across the diamond to retire a runner." },
  ],
  outfielder: [
    { name: "Catch", description: "Tracking down a fly ball for an out." },
    { name: "Diving Catch", description: "Full-extension grab to take away a hit." },
    { name: "Outfield Assist", description: "Throw from the outfield that retires a runner." },
  ],
};

export const positions = [
  { id: 'pitcher', name: 'Pitcher' },
  { id: 'batter', name: 'Batter' },
  { id: 'infielder', name: 'Infielder' },
  { id: 'outfielder', name: 'Outfielder' },
];
