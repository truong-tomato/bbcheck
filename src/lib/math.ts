export const toUiAmount = (amountRaw: bigint, decimals: number): number => {
  if (decimals <= 0) {
    return Number(amountRaw);
  }

  const divisor = 10n ** BigInt(decimals);
  const whole = amountRaw / divisor;
  const fractional = amountRaw % divisor;

  return Number(whole) + Number(fractional) / Number(divisor);
};

export const toPctSupply = (balance: number, supply: number): number => {
  if (!Number.isFinite(balance) || !Number.isFinite(supply) || supply <= 0) {
    return 0;
  }

  return (balance / supply) * 100;
};
