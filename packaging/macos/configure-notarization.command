#!/bin/zsh
# Run in your own Terminal; the password is read securely by Apple's tool.
set -eu
notary_team_id="${1:-}"
print 'Configure Apple notarization for Dance2Music'
print 'Use an app-specific password from https://account.apple.com/ (Sign-In and Security).'
print 'The login is validated by Apple and saved in your login keychain.'
print ''
read -r 'notary_apple_id?Apple account email: '
if [[ -z "$notary_team_id" ]]; then
  read -r 'notary_team_id?Developer Team ID: '
fi
notary_status=0
xcrun notarytool store-credentials Dance2Music \
  --apple-id "$notary_apple_id" --team-id "$notary_team_id" \
  --keychain "$HOME/Library/Keychains/login.keychain-db" || notary_status=$?
if [[ "$notary_status" -eq 0 ]]; then
  print '\nDance2Music notarization login is ready. Tell the assistant setup is done.'
else
  print '\nApple could not validate/store the login. See the message above and retry.'
fi
read -r '?Press Return to close this window.'
exit "$notary_status"
