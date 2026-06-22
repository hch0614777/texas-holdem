// A card is { value: 2..14, suit: 'H'|'D'|'C'|'S' }
// value: 11 = J, 12 = Q, 13 = K, 14 = A
// suit: 'H' (Hearts), 'D' (Diamonds), 'C' (Clubs), 'S' (Spades)

function evaluate5CardHand(hand) {
  // Sort cards descending
  const sorted = [...hand].sort((a, b) => b.value - a.value);
  const values = sorted.map(c => c.value);
  const suits = sorted.map(c => c.suit);

  const isFlush = suits.every(s => s === suits[0]);

  // Check straight
  const uniqueValues = [...new Set(values)];
  let isStraight = false;
  let straightHigh = 0;

  if (uniqueValues.length === 5) {
    if (values[0] - values[4] === 4) {
      isStraight = true;
      straightHigh = values[0];
    } else if (values[0] === 14 && values[1] === 5 && values[2] === 4 && values[3] === 3 && values[4] === 2) {
      isStraight = true;
      straightHigh = 5; // Ace counts as 1 (low)
    }
  }

  // Count value frequencies
  const counts = {};
  for (const v of values) {
    counts[v] = (counts[v] || 0) + 1;
  }
  const countPairs = Object.entries(counts).map(([val, cnt]) => ({
    value: parseInt(val),
    count: cnt
  }));
  // Sort countPairs: primary by count desc, secondary by value desc
  countPairs.sort((a, b) => b.count - a.count || b.value - a.value);

  // Determine hand type and return lexicographical score array
  // 9: Straight Flush
  if (isFlush && isStraight) {
    return { rank: 9, name: '同花顺 (Straight Flush)', score: [9, straightHigh] };
  }

  // 8: Four of a Kind
  if (countPairs[0].count === 4) {
    return { rank: 8, name: '四条 (Four of a Kind)', score: [8, countPairs[0].value, countPairs[1].value] };
  }

  // 7: Full House
  if (countPairs[0].count === 3 && countPairs[1].count === 2) {
    return { rank: 7, name: '葫芦 (Full House)', score: [7, countPairs[0].value, countPairs[1].value] };
  }

  // 6: Flush
  if (isFlush) {
    return { rank: 6, name: '同花 (Flush)', score: [6, ...values] };
  }

  // 5: Straight
  if (isStraight) {
    return { rank: 5, name: '顺子 (Straight)', score: [5, straightHigh] };
  }

  // 4: Three of a Kind
  if (countPairs[0].count === 3) {
    return { rank: 4, name: '三条 (Three of a Kind)', score: [4, countPairs[0].value, countPairs[1].value, countPairs[2].value] };
  }

  // 3: Two Pair
  if (countPairs[0].count === 2 && countPairs[1].count === 2) {
    return { rank: 3, name: '两对 (Two Pair)', score: [3, countPairs[0].value, countPairs[1].value, countPairs[2].value] };
  }

  // 2: One Pair
  if (countPairs[0].count === 2) {
    return { rank: 2, name: '一对 (One Pair)', score: [2, countPairs[0].value, countPairs[1].value, countPairs[2].value, countPairs[3].value] };
  }

  // 1: High Card
  return { rank: 1, name: '高牌 (High Card)', score: [1, ...values] };
}

// Function to find the best 5-card hand out of N cards (typically 7)
function getBestHand(cards) {
  if (cards.length < 5) {
    return { rank: 0, name: 'Invalid', score: [0], cards: cards };
  }

  // Generate all combinations of size 5 from cards
  function getCombinations(arr, k) {
    const result = [];
    function helper(start, combo) {
      if (combo.length === k) {
        result.push([...combo]);
        return;
      }
      for (let i = start; i < arr.length; i++) {
        combo.push(arr[i]);
        helper(i + 1, combo);
        combo.pop();
      }
    }
    helper(0, []);
    return result;
  }

  const combos = getCombinations(cards, 5);
  let bestHand = null;

  for (const combo of combos) {
    const evaluated = evaluate5CardHand(combo);
    if (!bestHand || compareScores(evaluated.score, bestHand.score) > 0) {
      bestHand = {
        ...evaluated,
        cards: combo
      };
    }
  }

  return bestHand;
}

// Compare two score arrays lexicographically
function compareScores(scoreA, scoreB) {
  const len = Math.max(scoreA.length, scoreB.length);
  for (let i = 0; i < len; i++) {
    const valA = scoreA[i] || 0;
    const valB = scoreB[i] || 0;
    if (valA !== valB) {
      return valA - valB;
    }
  }
  return 0;
}

// Evaluate 3-card hands for Zha Jin Hua
function evaluate3CardHand(hand) {
  const sorted = [...hand].sort((a, b) => b.value - a.value);
  const v0 = sorted[0].value;
  const v1 = sorted[1].value;
  const v2 = sorted[2].value;
  
  const s0 = sorted[0].suit;
  const s1 = sorted[1].suit;
  const s2 = sorted[2].suit;
  
  const isFlush = (s0 === s1 && s1 === s2);
  
  let isStraight = false;
  if (v0 - v1 === 1 && v1 - v2 === 1) {
    isStraight = true;
  } else if (v0 === 14 && v1 === 3 && v2 === 2) {
    isStraight = true;
  }
  
  // 6: 豹子 (Three of a Kind)
  if (v0 === v1 && v1 === v2) {
    return { rank: 6, name: '豹子 (Three of a Kind)', score: [6, v0] };
  }
  
  // 5: 同花顺 / 顺金 (Straight Flush)
  if (isFlush && isStraight) {
    const straightHigh = (v0 === 14 && v1 === 3) ? 3 : v0;
    return { rank: 5, name: '同花顺 (Straight Flush)', score: [5, straightHigh] };
  }
  
  // 4: 同花 / 金花 (Flush)
  if (isFlush) {
    return { rank: 4, name: '同花 (Flush)', score: [4, v0, v1, v2] };
  }
  
  // 3: 顺子 / 拖拉机 (Straight)
  if (isStraight) {
    const straightHigh = (v0 === 14 && v1 === 3) ? 3 : v0;
    return { rank: 3, name: '顺子 (Straight)', score: [3, straightHigh] };
  }
  
  // 2: 对子 (Pair)
  if (v0 === v1) {
    return { rank: 2, name: '对子 (Pair)', score: [2, v0, v2] };
  } else if (v1 === v2) {
    return { rank: 2, name: '对子 (Pair)', score: [2, v1, v0] };
  } else if (v0 === v2) {
    return { rank: 2, name: '对子 (Pair)', score: [2, v0, v1] };
  }
  
  // 1: 单张 / 高牌 (High Card)
  return { rank: 1, name: '高牌 (High Card)', score: [1, v0, v1, v2] };
}

module.exports = { getBestHand, compareScores, evaluate3CardHand };
