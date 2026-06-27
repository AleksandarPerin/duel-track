// Type declaration for the untyped edmonds-blossom npm package.
// The function accepts an adjacency list of weighted edges and returns
// a matching: an array where matching[i] = j means vertex i is matched to j.
// See: https://github.com/mattkrick/edmonds-blossom

declare module 'edmonds-blossom' {
  /**
   * Computes maximum weight perfect matching via Edmonds' blossom algorithm.
   * @param edges - Array of [vertex1, vertex2, weight] tuples
   * @returns Array where result[i] = j means vertex i is matched to vertex j (-1 if unmatched)
   */
  function blossom(edges: Array<[number, number, number]>): number[];
  export = blossom;
}
