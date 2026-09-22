using System;
using System.Collections;
using System.Collections.Generic;
using UnityEngine;
using UnityEngine.EventSystems;
using UnityEngine.UI;

namespace FindDifference
{
    [Serializable] public class Difference { public string id; public float x, y, radius; }
    [Serializable] public class DifferenceFile { public Difference[] differences; }

    public sealed class DifferenceHitArea : MonoBehaviour, IPointerClickHandler
    {
        public FindDifferenceGame game;
        public RectTransform image;
        public void OnPointerClick(PointerEventData eventData)
        {
            if (!RectTransformUtility.ScreenPointToLocalPointInRectangle(image, eventData.position, eventData.pressEventCamera, out var point)) return;
            var rect = image.rect;
            game.TryDifference(new Vector2((point.x - rect.xMin) / rect.width, 1f - (point.y - rect.yMin) / rect.height));
        }
    }

    // One flow controller; pages, buttons and panels are serialized scene objects, not runtime-created UI.
    public sealed class FindDifferenceGame : MonoBehaviour
    {
        public GameObject homePage, levelPage, gamePage, rankPage, resultModal, adModal;
        public Button homePlay, homeLevels, homeRank, levelsBack, gameBack, gameHint, gameTime, gameZoom, gameShare;
        public Button rankBack, resultRevive, resultRetry, resultHome, resultShare, adClose, adReturn;
        public Button[] levelButtons = new Button[5];
        public Image[] levelThumbnails = new Image[5];
        public Text[] levelCaptions = new Text[5];
        public Text homeContinue, levelTitle, levelName, livesText, timerText, progressText, resultTitle, resultSummary, adTimer, adStatus, rankBody;
        public Image topImage, bottomImage;
        public RectTransform topMarkers, bottomMarkers;

        static readonly string[] Names = { "皇家城堡庭院", "王室宴会厨房", "炼金术士实验室", "骑士团武器库", "巨龙宝库" };
        readonly HashSet<string> found = new HashSet<string>();
        Difference[] differences = Array.Empty<Difference>();
        int level = 1, lives = 3;
        float remaining, elapsed;
        bool playing, zoomed, reviveUsed;
        Action rewardedAction;
        Coroutine adRoutine;

        void Start()
        {
            homePlay.onClick.AddListener(() => StartLevel(Mathf.Clamp(PlayerPrefs.GetInt("fd_unlocked", 1), 1, 5)));
            homeLevels.onClick.AddListener(ShowLevels);
            homeRank.onClick.AddListener(ShowRank);
            levelsBack.onClick.AddListener(ShowHome);
            gameBack.onClick.AddListener(ShowLevels);
            gameHint.onClick.AddListener(() => ShowAd(UseHint));
            gameTime.onClick.AddListener(() => ShowAd(() => { remaining += 30; RefreshHud(); }));
            gameZoom.onClick.AddListener(() => { zoomed = !zoomed; topImage.rectTransform.localScale = bottomImage.rectTransform.localScale = Vector3.one * (zoomed ? 1.6f : 1f); });
            gameShare.onClick.AddListener(Share);
            rankBack.onClick.AddListener(ShowHome);
            resultRevive.onClick.AddListener(() => ShowAd(() => { lives = 1; remaining += 30; playing = true; resultModal.SetActive(false); RefreshHud(); }));
            resultRetry.onClick.AddListener(() => StartLevel(level));
            resultHome.onClick.AddListener(ShowLevels);
            resultShare.onClick.AddListener(Share);
            adClose.onClick.AddListener(CompleteAd);
            adReturn.onClick.AddListener(CompleteAd);
            for (int i = 0; i < levelButtons.Length; i++)
            {
                int id = i + 1;
                levelButtons[i].onClick.AddListener(() => { if (id <= PlayerPrefs.GetInt("fd_unlocked", 1)) StartLevel(id); });
            }
            ShowHome();
        }

        void Update()
        {
            if (!playing || adModal.activeSelf) return;
            remaining = Mathf.Max(0, remaining - Time.deltaTime);
            elapsed += Time.deltaTime;
            RefreshHud();
            if (remaining <= 0) Finish(false);
        }

        void Page(GameObject page)
        {
            homePage.SetActive(page == homePage);
            levelPage.SetActive(page == levelPage);
            gamePage.SetActive(page == gamePage);
            rankPage.SetActive(page == rankPage);
            resultModal.SetActive(false);
            adModal.SetActive(false);
            playing = page == gamePage && playing;
        }

        void ShowHome()
        {
            playing = false;
            Page(homePage);
            homeContinue.text = "第" + Mathf.Clamp(PlayerPrefs.GetInt("fd_unlocked", 1), 1, 5) + "关";
        }

        void ShowLevels()
        {
            playing = false;
            Page(levelPage);
            int unlocked = Mathf.Clamp(PlayerPrefs.GetInt("fd_unlocked", 1), 1, 5);
            for (int i = 0; i < 5; i++)
            {
                bool open = i < unlocked;
                levelCaptions[i].text = "第" + (i + 1) + "关\n" + Names[i] + (open ? "" : "\n🔒 通关上一关解锁");
                levelThumbnails[i].color = open ? Color.white : new Color(.58f, .58f, .60f, 1f);
                levelButtons[i].interactable = open;
            }
        }

        void ShowRank()
        {
            playing = false;
            Page(rankPage);
            int unlocked = Mathf.Clamp(PlayerPrefs.GetInt("fd_unlocked", 1), 1, 5);
            rankBody.text = "本机进度\n\n已解锁：" + unlocked + "/5 关\n\n";
            for (int i = 1; i <= 5; i++) rankBody.text += "第" + i + "关    " + (PlayerPrefs.GetInt("fd_clear_" + i) == 1 ? "已通关" : "未通关") + "\n";
            rankBody.text += "\n好友 / 全国排行榜待接入平台 SDK";
        }

        void StartLevel(int id)
        {
            var file = Resources.Load<TextAsset>($"Levels/level-{id:00}/differences");
            var a = Resources.Load<Sprite>($"Levels/level-{id:00}/scene-a");
            var b = Resources.Load<Sprite>($"Levels/level-{id:00}/scene-b");
            if (file == null || a == null || b == null) { Debug.LogError("Missing level " + id); return; }
            level = id;
            differences = JsonUtility.FromJson<DifferenceFile>(file.text).differences ?? Array.Empty<Difference>();
            found.Clear();
            lives = 3;
            remaining = 120;
            elapsed = 0;
            playing = true;
            reviveUsed = false;
            zoomed = false;
            topImage.rectTransform.localScale = bottomImage.rectTransform.localScale = Vector3.one;
            topImage.sprite = a;
            bottomImage.sprite = b;
            foreach (Transform child in topMarkers) Destroy(child.gameObject);
            foreach (Transform child in bottomMarkers) Destroy(child.gameObject);
            levelTitle.text = "第" + id + "关";
            levelName.text = Names[Mathf.Clamp(id - 1, 0, 4)];
            Page(gamePage);
            playing = true;
            RefreshHud();
        }

        public void TryDifference(Vector2 uv)
        {
            if (!playing || resultModal.activeSelf || adModal.activeSelf) return;
            foreach (var d in differences)
            {
                if (found.Contains(d.id) || Vector2.Distance(uv, new Vector2(d.x, d.y)) > d.radius) continue;
                found.Add(d.id);
                Mark(topMarkers, d);
                Mark(bottomMarkers, d);
                RefreshHud();
                if (found.Count == differences.Length) Finish(true);
                return;
            }
            lives--;
            RefreshHud();
            if (lives <= 0) Finish(false);
        }

        void Mark(RectTransform parent, Difference d)
        {
            var marker = new GameObject("Found - " + d.id, typeof(RectTransform), typeof(Image));
            marker.transform.SetParent(parent, false);
            var rect = marker.GetComponent<RectTransform>();
            rect.anchorMin = rect.anchorMax = new Vector2(d.x, 1f - d.y);
            rect.sizeDelta = Vector2.one * Mathf.Max(38, parent.rect.width * d.radius * 2);
            var image = marker.GetComponent<Image>();
            image.sprite = Resources.Load<Sprite>("UI/icon_progress_filled");
            image.color = new Color(1, .76f, .22f, .70f);
            image.raycastTarget = false;
        }

        void RefreshHud()
        {
            livesText.text = new string('♥', Mathf.Max(0, lives)) + new string('♡', Mathf.Max(0, 3 - lives));
            var t = Mathf.CeilToInt(remaining);
            timerText.text = $"{t / 60}:{t % 60:00}";
            progressText.text = found.Count + "/" + differences.Length;
        }

        void Finish(bool win)
        {
            playing = false;
            if (win)
            {
                PlayerPrefs.SetInt("fd_clear_" + level, 1);
                PlayerPrefs.SetInt("fd_unlocked", Mathf.Min(5, Mathf.Max(PlayerPrefs.GetInt("fd_unlocked", 1), level + 1)));
                PlayerPrefs.Save();
            }
            resultTitle.text = win ? "挑战成功" : "挑战失败";
            resultSummary.text = win ? $"用时 {Mathf.CeilToInt(elapsed)} 秒 · 找到全部 {differences.Length} 处" : "时间或生命已经耗尽";
            resultRevive.gameObject.SetActive(!win && !reviveUsed);
            resultModal.SetActive(true);
        }

        void UseHint()
        {
            foreach (var d in differences)
            {
                if (found.Contains(d.id)) continue;
                found.Add(d.id);
                Mark(topMarkers, d);
                Mark(bottomMarkers, d);
                RefreshHud();
                if (found.Count == differences.Length) Finish(true);
                return;
            }
        }

        // H5 development simulator. Platform-adapter implementations must replace this before release.
        void ShowAd(Action reward)
        {
            rewardedAction = reward;
            adModal.SetActive(true);
            adClose.gameObject.SetActive(false);
            adReturn.gameObject.SetActive(false);
            if (adRoutine != null) StopCoroutine(adRoutine);
            adRoutine = StartCoroutine(AdCountdown());
        }

        IEnumerator AdCountdown()
        {
            for (int t = 5; t > 0; --t)
            {
                adTimer.text = t.ToString();
                adStatus.text = "广告播放中，请稍候…";
                yield return new WaitForSecondsRealtime(1f);
            }
            adTimer.text = "0";
            adStatus.text = "观看完成，可关闭或返回";
            adClose.gameObject.SetActive(true);
            adReturn.gameObject.SetActive(true);
            adRoutine = null;
        }

        void CompleteAd()
        {
            if (adRoutine != null) return;
            adModal.SetActive(false);
            var action = rewardedAction;
            rewardedAction = null;
            if (resultModal.activeSelf) reviveUsed = true;
            action?.Invoke();
        }

        void Share()
        {
#if UNITY_WEBGL && !UNITY_EDITOR
            WebShare("来挑战我的找茬成绩！", Application.absoluteURL);
#else
            GUIUtility.systemCopyBuffer = "来挑战我的找茬成绩！";
            Debug.Log("分享文案已复制；平台发布时接入分享 SDK。");
#endif
        }

#if UNITY_WEBGL && !UNITY_EDITOR
        [System.Runtime.InteropServices.DllImport("__Internal")] static extern void WebShare(string title, string url);
#endif
    }
}
