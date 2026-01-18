#!/bin/bash

# Setup Test Scripts
# ให้สิทธิ์ execute สำหรับ test scripts

echo "🔧 Setting up test scripts..."

# Make scripts executable
chmod +x test-export-apis.sh
chmod +x test-commodity-charge.sh
chmod +x test-gas-delivery.sh
chmod +x test-all-export-apis.sh

echo "✅ All test scripts are now executable!"
echo ""
echo "📋 Available test scripts:"
echo "  • ./test-export-apis.sh     - Complete test suite with detailed output"
echo "  • ./test-commodity-charge.sh - Test only Commodity Charge Report"
echo "  • ./test-gas-delivery.sh    - Test only Gas Delivery Report"
echo "  • ./test-all-export-apis.sh - Test all APIs with simple output"
echo ""
echo "🚀 You can now run any of these scripts to test the export APIs!"
