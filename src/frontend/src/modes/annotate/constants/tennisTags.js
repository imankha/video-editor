export const tennisTags = {
  serve: [
    { name: "Ace", description: "Serve that lands in untouched for a point." },
    { name: "Service Winner", description: "Serve that forces a weak return and an easy point." },
    { name: "Kick Serve", description: "Heavy topspin serve that bounces high to push the returner back." },
  ],
  baseline: [
    { name: "Forehand Winner", description: "Forehand that lands in for an unreturnable point." },
    { name: "Backhand Winner", description: "Backhand that lands in for an unreturnable point." },
    { name: "Rally", description: "Sustained baseline exchange that earns the point." },
  ],
  net: [
    { name: "Volley", description: "Putting away a ball out of the air at the net." },
    { name: "Overhead", description: "Smash on a high ball for a point." },
    { name: "Drop Shot", description: "Soft touch that dies just over the net to win the point." },
  ],
  defense: [
    { name: "Passing Shot", description: "Drive past an opponent who has come to the net." },
    { name: "Return", description: "Strong return of serve that takes control of the rally." },
    { name: "Lob", description: "High shot over the opponent at the net to reset or win the point." },
  ],
};

export const positions = [
  { id: 'serve', name: 'Serve' },
  { id: 'baseline', name: 'Baseline' },
  { id: 'net', name: 'Net' },
  { id: 'defense', name: 'Defense' },
];
