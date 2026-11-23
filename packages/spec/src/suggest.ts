/** Edit-distance suggestions shared by the query compiler and the schema error mapping. Pure. */

const lev = (a: string, b: string): number => {
  const dp = Array.from({ length: a.length + 1 }, (_, i) => [i, ...new Array<number>(b.length).fill(0)]);
  for (let j = 1; j <= b.length; j++) (dp[0] as number[])[j] = j;
  for (let i = 1; i <= a.length; i++)
    for (let j = 1; j <= b.length; j++)
      (dp[i] as number[])[j] = Math.min(
        (dp[i - 1] as number[])[j]! + 1,
        (dp[i] as number[])[j - 1]! + 1,
        (dp[i - 1] as number[])[j - 1]! + (a[i - 1] === b[j - 1] ? 0 : 1),
      );
  return (dp[a.length] as number[])[b.length] ?? 99;
};

/** Up to three candidates within a small edit distance of `name`, closest first. */
export const didYouMean = (name: string, candidates: ReadonlyArray<string>): ReadonlyArray<string> =>
  candidates
    .map((c) => [c, lev(name.toLowerCase(), c.toLowerCase())] as const)
    .filter(([, d]) => d <= Math.max(2, Math.floor(name.length / 3)))
    .sort((x, y) => x[1] - y[1])
    .slice(0, 3)
    .map(([c]) => c);
