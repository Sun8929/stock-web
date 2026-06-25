// Pure TypeScript implementation of Decision Tree and Random Forest Regressor
// Mimics scikit-learn's RandomForestRegressor behavior for stock return prediction

interface TreeNode {
  isLeaf: boolean;
  value?: number; // For leaf nodes: the predicted value (mean target)
  featureIndex?: number; // For split nodes: index of the splitting feature
  threshold?: number; // For split nodes: threshold value for split
  left?: TreeNode;
  right?: TreeNode;
}

class DecisionTreeRegressor {
  private maxDepth: number;
  private minSamplesSplit: number;
  private root: TreeNode | null = null;

  constructor(maxDepth = 10, minSamplesSplit = 5) {
    this.maxDepth = maxDepth;
    this.minSamplesSplit = minSamplesSplit;
  }

  public fit(X: number[][], y: number[]): void {
    this.root = this.buildTree(X, y, 0);
  }

  public predict(x: number[]): number {
    if (!this.root) return 0;
    return this.traverseTree(x, this.root);
  }

  private calculateMSE(y: number[]): number {
    if (y.length === 0) return 0;
    const mean = y.reduce((sum, val) => sum + val, 0) / y.length;
    return y.reduce((sum, val) => sum + Math.pow(val - mean, 2), 0) / y.length;
  }

  private buildTree(X: number[][], y: number[], depth: number): TreeNode {
    const numSamples = X.length;
    const numFeatures = numSamples > 0 ? X[0].length : 0;

    // Base cases: check if split is necessary
    const isConstantY = y.every(val => val === y[0]);
    if (
      depth >= this.maxDepth ||
      numSamples < this.minSamplesSplit ||
      isConstantY ||
      numFeatures === 0
    ) {
      return {
        isLeaf: true,
        value: numSamples > 0 ? y.reduce((sum, val) => sum + val, 0) / numSamples : 0,
      };
    }

    // Feature bagging: randomly select a subset of features to split on
    const featuresToTry: number[] = [];
    const numFeaturesToTry = Math.max(1, Math.floor(Math.sqrt(numFeatures)));
    while (featuresToTry.length < numFeaturesToTry) {
      const idx = Math.floor(Math.random() * numFeatures);
      if (!featuresToTry.includes(idx)) {
        featuresToTry.push(idx);
      }
    }

    let bestFeatureIndex = -1;
    let bestThreshold = 0;
    let bestMSEDecrease = -Infinity;
    const currentMSE = this.calculateMSE(y);
    let bestLeftIndices: number[] = [];
    let bestRightIndices: number[] = [];

    // Search for the best split
    for (const featIdx of featuresToTry) {
      const values = X.map(row => row[featIdx]);
      // Sort unique values to find candidate thresholds
      const uniqueValues = Array.from(new Set(values)).sort((a, b) => a - b);
      
      // If only one unique value, we can't split on this feature
      if (uniqueValues.length <= 1) continue;

      // Test splits at the midpoints between adjacent unique values
      for (let i = 0; i < uniqueValues.length - 1; i++) {
        const threshold = (uniqueValues[i] + uniqueValues[i + 1]) / 2;

        const leftIndices: number[] = [];
        const rightIndices: number[] = [];

        for (let j = 0; j < numSamples; j++) {
          if (X[j][featIdx] <= threshold) {
            leftIndices.push(j);
          } else {
            rightIndices.push(j);
          }
        }

        if (leftIndices.length === 0 || rightIndices.length === 0) continue;

        const yLeft = leftIndices.map(idx => y[idx]);
        const yRight = rightIndices.map(idx => y[idx]);

        const mseLeft = this.calculateMSE(yLeft);
        const mseRight = this.calculateMSE(yRight);

        // Weighted MSE of the split
        const splitMSE = (leftIndices.length / numSamples) * mseLeft + (rightIndices.length / numSamples) * mseRight;
        const mseDecrease = currentMSE - splitMSE;

        if (mseDecrease > bestMSEDecrease) {
          bestMSEDecrease = mseDecrease;
          bestFeatureIndex = featIdx;
          bestThreshold = threshold;
          bestLeftIndices = leftIndices;
          bestRightIndices = rightIndices;
        }
      }
    }

    // If no split was found that improves MSE, return leaf
    if (bestFeatureIndex === -1 || bestMSEDecrease <= 0) {
      return {
        isLeaf: true,
        value: y.reduce((sum, val) => sum + val, 0) / numSamples,
      };
    }

    // Recursively build children
    const XLeft = bestLeftIndices.map(idx => X[idx]);
    const yLeft = bestLeftIndices.map(idx => y[idx]);
    const XRight = bestRightIndices.map(idx => X[idx]);
    const yRight = bestRightIndices.map(idx => y[idx]);

    return {
      isLeaf: false,
      featureIndex: bestFeatureIndex,
      threshold: bestThreshold,
      left: this.buildTree(XLeft, yLeft, depth + 1),
      right: this.buildTree(XRight, yRight, depth + 1),
    };
  }

  private traverseTree(x: number[], node: TreeNode): number {
    if (node.isLeaf) {
      return node.value ?? 0;
    }
    const val = x[node.featureIndex!];
    if (val <= node.threshold!) {
      return this.traverseTree(x, node.left!);
    } else {
      return this.traverseTree(x, node.right!);
    }
  }
}

export class RandomForestRegressor {
  private nEstimators: number;
  private maxDepth: number;
  private minSamplesSplit: number;
  private trees: DecisionTreeRegressor[] = [];

  constructor(nEstimators = 100, maxDepth = 10, minSamplesSplit = 5) {
    this.nEstimators = nEstimators;
    this.maxDepth = maxDepth;
    this.minSamplesSplit = minSamplesSplit;
  }

  public fit(X: number[][], y: number[]): void {
    this.trees = [];
    const numSamples = X.length;
    if (numSamples === 0) return;

    for (let i = 0; i < this.nEstimators; i++) {
      // Bootstrap sampling (draw N samples with replacement)
      const XSample: number[][] = [];
      const ySample: number[] = [];

      for (let j = 0; j < numSamples; j++) {
        const randomIdx = Math.floor(Math.random() * numSamples);
        XSample.push(X[randomIdx]);
        ySample.push(y[randomIdx]);
      }

      const tree = new DecisionTreeRegressor(this.maxDepth, this.minSamplesSplit);
      tree.fit(XSample, ySample);
      this.trees.push(tree);
    }
  }

  public predict(x: number[]): number {
    if (this.trees.length === 0) return 0;
    const predictions = this.trees.map(tree => tree.predict(x));
    return predictions.reduce((sum, val) => sum + val, 0) / this.trees.length;
  }
}
