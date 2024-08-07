@echo off
echo Bulding...
call npm run core:build
call npm run components:build
echo DONE
if %errorlevel% neq 0 exit /b %errorlevel%
echo Testing...
call npm run core:test-ci
::call npm run components:test-ci
echo DONE
if %errorlevel% neq 0 exit /b %errorlevel%
echo Pushing develop...
git push
echo DONE
echo Pushing master...
git checkout master
git merge develop
git push
echo DONE
git checkout develop
echo Ready