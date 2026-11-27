// Pakistani CNIC / B-Form numbers are 13 digits, written as 12345-1234567-1.
// The mask keeps only digits as the user types and re-inserts the dashes.
export const maskCnic = (value: string) => {
  const digits = value.replace(/\D/g, '').slice(0, 13);
  return [digits.slice(0, 5), digits.slice(5, 12), digits.slice(12)].filter(Boolean).join('-');
};

export const cnicDigits = (value: string) => value.replace(/\D/g, '');
