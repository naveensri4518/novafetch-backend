(async () => {
  try {
    const res = await fetch('http://localhost:5000/api/download/info', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url: 'https://www.instagram.com/reel/DXWhyeHEc2N/?igsh=MWZsZHFvNjlw' })
    });
    console.log(res.status);
    console.log(await res.text());
  } catch (err) {
    console.error(err);
  }
})();
