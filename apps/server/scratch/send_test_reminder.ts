import http from 'http';

async function main() {
  console.log('🚀 Sending request to active server process on port 4000 to deliver demo reminder...');

  const data = JSON.stringify({
    phone: '8328232607',
  });

  const options = {
    hostname: 'localhost',
    port: 4000,
    path: '/api/v1/whatsapp/send-demo',
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Content-Length': Buffer.byteLength(data),
    },
  };

  const req = http.request(options, (res) => {
    let responseBody = '';

    res.on('data', (chunk) => {
      responseBody += chunk;
    });

    res.on('end', () => {
      if (res.statusCode === 200) {
        console.log('✅ Success: ' + responseBody);
        console.log('🎉 The demo reminder with your scanner image has been successfully sent to 8328232607!');
      } else {
        console.error('❌ Error (Status ' + res.statusCode + '): ' + responseBody);
        console.error('Check server logs for details on connection pairing status.');
      }
    });
  });

  req.on('error', (e) => {
    console.error('❌ Network Connection Error: ' + e.message);
    console.log('Make sure your development server (npm run dev) is actively running on port 4000.');
  });

  req.write(data);
  req.end();
}

main().catch(console.error);
