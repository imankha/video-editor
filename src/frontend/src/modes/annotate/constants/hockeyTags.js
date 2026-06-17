export const hockeyTags = {
  forward: [
    { name: "Goal", description: "Putting the puck in the net to score." },
    { name: "Assist", description: "Pass that directly sets up a teammate's goal." },
    { name: "Deke", description: "Stickhandling move that beats a defender or goalie." },
  ],
  defenseman: [
    { name: "Check", description: "Body or stick check that separates an opponent from the puck." },
    { name: "Shot Block", description: "Getting in front of an opponent's shot to stop it." },
    { name: "Breakout", description: "Clean pass out of the defensive zone to start the rush." },
  ],
  goalie: [
    { name: "Save", description: "Stopping a shot from beating you into the net." },
    { name: "Glove Save", description: "Catching the puck cleanly out of the air." },
    { name: "Poke Check", description: "Stick jab that knocks the puck off an attacker on a breakaway." },
  ],
};

export const positions = [
  { id: 'forward', name: 'Forward' },
  { id: 'defenseman', name: 'Defenseman' },
  { id: 'goalie', name: 'Goalie' },
];
