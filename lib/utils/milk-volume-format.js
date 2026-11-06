const formatMilkVolume = (value) => {
  const numericValue = Number(value ?? 0);
  if (!Number.isFinite(numericValue)) return '0';

  const [mantissa, exponentText] = numericValue.toString().toLowerCase().split('e');
  const exponent = Number(exponentText || 0);
  const negative = mantissa.startsWith('-');
  const unsignedMantissa = negative ? mantissa.slice(1) : mantissa;
  const [wholePart, fractionalPart = ''] = unsignedMantissa.split('.');
  const digits = wholePart + fractionalPart;
  const decimalPosition = wholePart.length + exponent;
  let integerPart;
  let decimalPart;

  if (decimalPosition <= 0) {
    integerPart = '0';
    decimalPart = `${'0'.repeat(-decimalPosition)}${digits}`;
  } else if (decimalPosition >= digits.length) {
    integerPart = `${digits}${'0'.repeat(decimalPosition - digits.length)}`;
    decimalPart = '';
  } else {
    integerPart = digits.slice(0, decimalPosition);
    decimalPart = digits.slice(decimalPosition);
  }

  integerPart = integerPart.replace(/^0+(?=\d)/, '') || '0';
  decimalPart = decimalPart.replace(/0+$/, '');
  const groupedInteger = integerPart.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return `${negative ? '-' : ''}${groupedInteger}${decimalPart ? `.${decimalPart}` : ''}`;
};

module.exports = { formatMilkVolume };
