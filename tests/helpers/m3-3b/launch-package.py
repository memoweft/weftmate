#!/usr/bin/python3
"""Test launcher sets DYLD only after macOS launches the system interpreter."""
import os
import sys
executable = os.environ['M3_3B_APP_EXECUTABLE']
env = dict(os.environ)
env['DYLD_INSERT_LIBRARIES'] = env['M3_3B_SECURITY_LIBRARY']
os.execve(executable, [executable] + sys.argv[1:], env)
