/**
 * Registered games that can consume randomness and resolve a round.
 * Contract IDs are optional so deployments can enable each game independently.
 */
const createGameRegistry = ({ coinFlipContractId, diceRollContractId } = {}) => {
  const games = {};
  if (coinFlipContractId) {
    games[coinFlipContractId] = {
      name: 'coin-flip',
      contractId: coinFlipContractId,
      resolveMethod: 'resolve_bet',
      alreadyResolvedErrorCode: 8,
    };
  }
  if (diceRollContractId) {
    games[diceRollContractId] = {
      name: 'dice-roll',
      contractId: diceRollContractId,
      resolveMethod: 'resolve_roll',
      alreadyResolvedErrorCode: 8,
    };
  }
  return games;
};

module.exports = { createGameRegistry };
