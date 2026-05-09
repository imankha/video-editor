export const lacrosseTags = {
  attack: [
    { name: "Goal", description: "Scoring by putting the ball in the net." },
    { name: "Assist", description: "Pass that directly leads to a teammate's goal." },
    { name: "Dodge", description: "Beating a defender one-on-one to create a scoring chance." },
  ],
  midfield: [
    { name: "Ground Ball", description: "Winning possession of a loose ball." },
    { name: "Transition", description: "Carrying or passing the ball quickly up the field on a fast break." },
    { name: "Shot", description: "On-target shots that test the goalkeeper." },
  ],
  defense: [
    { name: "Check", description: "Legal stick check that dislodges the ball from an opponent." },
    { name: "Clear", description: "Moving the ball from the defensive end past midfield." },
    { name: "Caused Turnover", description: "Forcing the opponent to lose possession through a check or pressure." },
  ],
  goalie: [
    { name: "Save", description: "Goalkeeper stopping a shot." },
    { name: "Outlet", description: "Quick pass after a save to start the transition." },
  ],
};

export const positions = [
  { id: 'attack', name: 'Attack' },
  { id: 'midfield', name: 'Midfield' },
  { id: 'defense', name: 'Defense' },
  { id: 'goalie', name: 'Goalie' },
];
