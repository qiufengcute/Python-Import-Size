# Python Import Size

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![GitHub Stars](https://img.shields.io/github/stars/qiufengcute/python-import-size?style=flat)](https://github.com/qiufengcute/python-import-size)

Display Python import library sizes inline in VSCode, similar to ErrorLens but for import statements.

## Features

This extension analyzes Python import statements and displays the size of each imported library directly in the code editor, on the same line as the import statement. The size information appears on the right side of the line, similar to how ErrorLens displays error messages.

- Shows import library sizes in human-readable format (Bytes, KB, MB, GB)
- Supports both `import` and `from ... import` statements
- Automatically updates when you modify import statements
- Caches module sizes for better performance
- Works with built-in modules and third-party packages

Example:
```python
import os                   ≈ 39.93 KB
import json                 ≈ 93.28 KB
import hashlib              ≈ 9.38 KB
```

## Requirements

- Python 3.x must be installed and accessible from the command line
- VS Code must be able to run Python commands to determine module locations and sizes

**Enjoy!**
