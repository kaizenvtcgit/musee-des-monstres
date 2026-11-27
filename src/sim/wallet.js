export class Wallet {
  constructor(money) {
    this.money = money;
    this.totalEarned = 0;
    // test mode (src/testmode.js): everything is free, the money never goes down
    this.unlimited = false;
  }

  canAfford(n) {
    if (this.unlimited) return true;
    return this.money >= 0 && this.money >= n;
  }

  spend(n) {
    if (!this.canAfford(n)) return false;
    if (!this.unlimited) this.money -= n;
    return true;
  }

  earn(n) {
    this.money += n;
    this.totalEarned += n;
  }

  // Always applied, may make money negative (salaries).
  charge(n) {
    if (!this.unlimited) this.money -= n;
  }
}
