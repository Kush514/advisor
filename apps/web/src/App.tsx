import { useEffect, useState } from 'react';
import { HealthResponse } from '@vmone/shared';

function App() {
  const [apiStatus, setApiStatus] = useState<string>('Checking API...');

  useEffect(() => {
    fetch('/api/health')
      .then(res => res.json())
      .then((data: HealthResponse) => setApiStatus(`API Status: ${data.message}`))
      .catch(() => setApiStatus('API Status: Disconnected'));
  }, []);

  return (
    <div className="min-h-screen bg-gray-50 flex flex-col items-center justify-center p-4">
      <div className="max-w-md w-full bg-white p-8 rounded-xl shadow-md text-center">
        <h1 className="text-2xl font-bold text-gray-900 mb-4">
          VM One Product Advisor
        </h1>
        <p className="text-gray-600 mb-6">
          Initializing phase 0/1 foundation.
        </p>
        <div className="text-sm px-4 py-2 bg-gray-100 rounded-md inline-block text-gray-700">
          {apiStatus}
        </div>
      </div>
    </div>
  );
}

export default App;
